import {
	CAPABILITY_REGISTRY,
	MCP_MAX_OUTPUT_CHARS,
	formatMcpOutput,
	getCapability,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import { SessionManager, type Session } from '@sessions';
import { log } from '@utils';
import type { McpErrorCode, McpResourceDescriptor, McpToolDescriptor, McpToolResult } from './protocol';
import { readMcpSettings, type McpSettings } from './settings';
import { SlidingWindowThrottle } from './throttle';

/**
 * Transport-agnostic MCP capability surface: lists tools/resources, gates by the
 * rewst-buddy.mcp.* settings, resolves the org's session, and runs the
 * capability — read-only is enforced here regardless of the caller. mcpServer.ts
 * wires these into the in-extension MCP HTTP server; nothing here knows about
 * HTTP. Every call is audited to the output channel so the user can see what an
 * external agent did.
 */

// An external agent can loop fast and each call hits a real org through the
// user's cookie session, so cap MCP-originated calls independently of the chat.
const THROTTLE = new SlidingWindowThrottle(30, 10_000);
type AuditOutcome = 'ok' | 'approval_required' | `error:${McpErrorCode}`;

/** Parameters for one tool call; orgId may also travel inside `arguments`. */
export interface CallToolParams {
	name: string;
	arguments?: Record<string, unknown>;
	orgId?: string;
}

/** A single resource's text content. */
export interface ResourceContent {
	uri: string;
	mimeType: string;
	text: string;
}

export class McpError extends Error {
	constructor(
		readonly code: McpErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'McpError';
	}
}

/**
 * Enforces the write-org allowlist: a write capability may only run against an
 * org on rewst-buddy.mcp.writeOrgAllowlist. An empty allowlist means "any managed
 * org" (logged as a warning, since nothing then caps the blast radius). Reads are
 * never restricted. This is the reliable, boundary-level gate for the MCP model,
 * where the per-call approval modal — hosted in VS Code, not the external client —
 * may never surface to the operator.
 */
function assertOrgWriteAllowed(capability: Capability, orgId: string, settings: McpSettings): void {
	if (capability.access !== 'write') return;
	if (settings.writeOrgAllowlist.length === 0) {
		log.info(`[MCP] write allowlist empty; "${capability.spec.name}" may target any managed org (${orgId}).`);
		return;
	}
	if (!settings.writeOrgAllowlist.includes(orgId)) {
		throw new McpError(
			'org_not_allowlisted',
			`Writes to org "${orgId}" are not allowed. Add it to rewst-buddy.mcp.writeOrgAllowlist in VS Code to permit write tools against this org.`,
		);
	}
}

/** Whether a capability is exposed to MCP under the current settings. */
function isExposed(capability: Capability, settings: McpSettings): boolean {
	if (!capability.mcp) return false;
	if (capability.dangerous) {
		if (!settings.enableDangerousGraphqlMutation) return false;
	} else if (capability.access === 'write') {
		if (!settings.enableWriteTools) return false;
	}
	return true;
}

function exposedCapabilities(settings: McpSettings): Capability[] {
	return CAPABILITY_REGISTRY.filter(capability => isExposed(capability, settings));
}

/** Whether a capability, looked up by name, is exposed under the current settings. */
function isCapabilityExposed(name: string, settings: McpSettings): boolean {
	const capability = getCapability(name);
	return capability ? isExposed(capability, settings) : false;
}

function asString(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function auditOutcomeForText(text: string): 'ok' | 'approval_required' {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith('{')) return 'ok';
	try {
		const parsed = JSON.parse(trimmed) as { status?: unknown };
		return parsed && typeof parsed === 'object' && parsed.status === 'approval_required'
			? 'approval_required'
			: 'ok';
	} catch {
		return 'ok';
	}
}

// The tool name (and orgId, on some paths) originate in the client request, so
// strip line breaks before logging to keep each audit record on its own line —
// otherwise a crafted tool name could inject forged audit entries. Unicode line
// (U+2028) and paragraph (U+2029) separators are stripped too for defense in depth.
function sanitizeAuditField(value: string): string {
	return value.replace(/[\r\n\t\u2028\u2029]/g, ' ').trim() || '—';
}

function logCallToolAudit(tool: string, orgId: string, outcome: AuditOutcome, startedAt: number): void {
	const safeTool = sanitizeAuditField(tool);
	const safeOrgId = sanitizeAuditField(orgId);
	log.info(`[MCP audit] tool=${safeTool} orgId=${safeOrgId} outcome=${outcome} durationMs=${Date.now() - startedAt}`);
}

/** Validates the session, attempting one refresh, before a capability runs. */
async function ensureValidSession(session: Session): Promise<void> {
	if (await session.validate()) return;
	try {
		await session.refreshToken();
	} catch {
		throw new McpError(
			'refresh_failed',
			'The Rewst session could not be refreshed. Re-authenticate in VS Code (Rewst Buddy: New Rewst Session).',
		);
	}
	if (!(await session.validate())) {
		throw new McpError(
			'refresh_failed',
			'The Rewst session is no longer valid. Re-authenticate in VS Code (Rewst Buddy: New Rewst Session).',
		);
	}
}

/** Resolves the session + org context a capability runs against. */
async function resolveContext(
	capability: Capability,
	args: Record<string, unknown>,
	requestOrgId: string | undefined,
): Promise<CapabilityContext> {
	const sessions = SessionManager.getActiveSessions();
	if (sessions.length === 0) {
		throw new McpError(
			'no_session',
			'No Rewst sessions are active. Open VS Code with Rewst Buddy and sign in, then retry.',
		);
	}
	if (capability.requiresOrg === false) {
		return { session: sessions[0], orgId: sessions[0].profile.org.id, sessions };
	}
	const orgId = asString(args, 'orgId') ?? requestOrgId;
	if (!orgId) {
		throw new McpError('org_required', 'This tool requires an "orgId" argument. Call list_orgs to find one.');
	}
	let session: Session;
	try {
		session = SessionManager.getSessionForOrg(orgId);
	} catch {
		throw new McpError('org_not_found', `No active session manages org "${orgId}". Call list_orgs for valid ids.`);
	}
	await ensureValidSession(session);
	return { session, orgId, sessions };
}

function describeTool(capability: Capability): McpToolDescriptor {
	return {
		name: capability.spec.name,
		description: capability.spec.description,
		inputSchema: capability.spec.inputSchema ?? { type: 'object', properties: {} },
	};
}

export function listTools(settings: McpSettings = readMcpSettings()): McpToolDescriptor[] {
	return exposedCapabilities(settings).map(describeTool);
}

export async function callTool(
	params: CallToolParams,
	settings: McpSettings = readMcpSettings(),
): Promise<McpToolResult> {
	const startedAt = Date.now();
	let auditOrgId = '—';
	let auditOutcome: AuditOutcome = 'ok';
	try {
		const capability = getCapability(params.name);
		if (!capability || !capability.mcp) {
			throw new McpError('unknown_tool', `Unknown tool "${params.name}".`);
		}
		if (capability.dangerous && !settings.enableDangerousGraphqlMutation) {
			throw new McpError(
				'write_disabled',
				`"${params.name}" can run arbitrary GraphQL mutations against the live Rewst organization and is disabled. Enable rewst-buddy.mcp.enableDangerousGraphqlMutation in VS Code.`,
			);
		}
		if (!capability.dangerous && capability.access === 'write' && !settings.enableWriteTools) {
			throw new McpError(
				'write_disabled',
				`"${params.name}" changes Rewst data and write tools are disabled. Enable rewst-buddy.mcp.enableWriteTools in VS Code.`,
			);
		}
		if (!isExposed(capability, settings)) {
			throw new McpError('unknown_tool', `Tool "${params.name}" is not enabled.`);
		}
		if (!THROTTLE.tryAcquire()) {
			throw new McpError(
				'rate_limited',
				`Too many MCP calls; slow down and retry in ~${Math.ceil(THROTTLE.retryAfterMs() / 1000)}s.`,
			);
		}

		const args = params.arguments ?? {};
		const ctx = await resolveContext(capability, args, params.orgId);
		auditOrgId = capability.requiresOrg === false ? '—' : ctx.orgId || '—';
		// Reject a disallowed write before the capability runs (and before its
		// approval modal, which may never surface to an external MCP client).
		assertOrgWriteAllowed(capability, ctx.orgId, settings);
		try {
			const text = await capability.run(args, ctx);
			auditOutcome = auditOutcomeForText(text);
			return { text: formatMcpOutput(params.name, text) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			auditOutcome = `error:${error instanceof McpError ? error.code : 'graphql_error'}`;
			// A capability that throws is a tool-execution failure the agent should
			// see, not a transport error; surface it as an isError result.
			return { text: message, isError: true };
		}
	} catch (error) {
		auditOutcome = `error:${error instanceof McpError ? error.code : 'internal'}`;
		throw error;
	} finally {
		logCallToolAudit(params.name, auditOrgId, auditOutcome, startedAt);
	}
}

// Resources are a thin, bounded view over the same read capabilities. Client
// support varies, so this stays tools-first: only per-active-org collection URIs
// are advertised, not every individual template.
export function listResources(settings: McpSettings = readMcpSettings()): McpResourceDescriptor[] {
	// Only advertise a collection when its backing list capability is exposed, so
	// resources honour the same allowlist/exposure gates as tools.
	const templatesExposed = isCapabilityExposed('list_templates', settings);
	const workflowsExposed = isCapabilityExposed('list_workflows', settings);
	if (!templatesExposed && !workflowsExposed) return [];
	const resources: McpResourceDescriptor[] = [];
	for (const session of SessionManager.getActiveSessions()) {
		const { id, name } = session.profile.org;
		if (!id) continue;
		if (templatesExposed) {
			resources.push({ uri: `rewst://${id}/templates`, name: `${name} templates`, mimeType: 'text/plain' });
		}
		if (workflowsExposed) {
			resources.push({ uri: `rewst://${id}/workflows`, name: `${name} workflows`, mimeType: 'text/plain' });
		}
	}
	return resources;
}

interface ParsedResourceUri {
	orgId: string;
	collection: 'templates' | 'workflows';
	id?: string;
}

function parseResourceUri(uri: string): ParsedResourceUri | undefined {
	const match = /^rewst:\/\/([^/]+)\/(templates|workflows)(?:\/(.+))?$/.exec(uri);
	if (!match) return undefined;
	return { orgId: match[1], collection: match[2] as 'templates' | 'workflows', id: match[3] };
}

export async function readResource(uri: string, settings: McpSettings = readMcpSettings()): Promise<ResourceContent> {
	const parsed = parseResourceUri(uri);
	if (!parsed) {
		throw new McpError('invalid_request', `Unrecognized resource URI: ${uri}`);
	}
	const toolName =
		parsed.collection === 'templates'
			? parsed.id
				? 'get_template'
				: 'list_templates'
			: parsed.id
				? 'get_workflow'
				: 'list_workflows';
	const capability = getCapability(toolName);
	if (!capability) throw new McpError('internal', `Missing capability for resource ${uri}`);
	// Resources run capabilities directly, so enforce the same exposure/allowlist
	// gates here — otherwise a disabled or non-allowlisted tool is reachable by URI.
	if (!isExposed(capability, settings)) {
		throw new McpError('unknown_tool', `Resource ${uri} is not available; the tool "${toolName}" is not enabled.`);
	}
	// Resource reads hit the org API like tool calls, so they share the same throttle.
	if (!THROTTLE.tryAcquire()) {
		throw new McpError(
			'rate_limited',
			`Too many MCP calls; slow down and retry in ~${Math.ceil(THROTTLE.retryAfterMs() / 1000)}s.`,
		);
	}

	const args: Record<string, unknown> = { orgId: parsed.orgId };
	if (parsed.id) args[parsed.collection === 'templates' ? 'templateId' : 'workflowId'] = parsed.id;
	const ctx = await resolveContext(capability, args, parsed.orgId);
	const text = formatMcpOutput(toolName, await capability.run(args, ctx));
	log.info(`MCP readResource: ${uri}`);
	return { uri, mimeType: 'text/plain', text };
}

/** Exposed for tests: resets the throttle window. */
export function _resetMcpThrottleForTesting(): void {
	(THROTTLE as unknown as { hits: number[] }).hits.length = 0;
}
