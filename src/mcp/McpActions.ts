import {
	CAPABILITY_REGISTRY,
	MCP_MAX_OUTPUT_CHARS,
	formatMcpOutput,
	getCapability,
	runWithApprovalOrigin,
	type ApprovalOrigin,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import { WorkingScopeManager } from '@models';
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
	/** Who is calling, for the approval modal wording. Defaults to an external MCP client. */
	origin?: ApprovalOrigin;
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
 * The orgs a tool may operate on: the user's pinned working orgs folded together
 * with the persistent `alwaysAllowedOrgs` setting (see WorkingScopeManager and
 * McpSettings). This is the ambient, model-immutable blast-radius cap behind #87.
 */
function effectiveAllowedOrgs(settings: McpSettings): Set<string> {
	return new Set([...WorkingScopeManager.getOrgs(), ...settings.alwaysAllowedOrgs]);
}

/**
 * Enforces the working scope at the boundary, the reliable gate for the MCP model
 * where the per-call approval modal — hosted in VS Code, not the external client —
 * may never surface to the operator:
 *
 * - Writes must target an org in the effective allowed set. Empty set ⇒ no writes
 *   (the safe default: pin a working org or set alwaysAllowedOrgs to permit one).
 * - When a working workflow is pinned, a write that names a workflow must name one
 *   in scope.
 * - Reads are scoped to the effective set only under strict scope and only once a
 *   working org is pinned; with nothing pinned, reads stay cross-org so the user
 *   can still browse and choose what to pin.
 *
 * Org-agnostic discovery tools (requiresOrg:false, e.g. list_orgs, the working-
 * scope tools) are never gated, so the user can always find an org and pin it.
 */
function assertScopeAllowed(
	capability: Capability,
	orgId: string,
	args: Record<string, unknown>,
	settings: McpSettings,
): void {
	if (capability.requiresOrg === false) return;
	const effective = effectiveAllowedOrgs(settings);
	const workingOrgs = WorkingScopeManager.getOrgs();

	if (capability.access === 'write') {
		if (!effective.has(orgId)) {
			throw new McpError('org_out_of_scope', writeOutOfScopeMessage(orgId, effective));
		}
		const workflows = WorkingScopeManager.getWorkflows();
		if (workflows.length > 0) {
			const workflowId = asString(args, 'workflowId');
			if (workflowId && !workflows.includes(workflowId)) {
				throw new McpError(
					'workflow_out_of_scope',
					`Workflow "${workflowId}" is not in the working scope (${workflows.join(', ')}). ` +
						'Change the working workflow in VS Code (Rewst Buddy: Set Working Scope) to edit a different one.',
				);
			}
		}
		return;
	}

	if (settings.workingOrgScope === 'strict' && workingOrgs.length > 0 && !effective.has(orgId)) {
		throw new McpError(
			'org_out_of_scope',
			`Reads are scoped to the working orgs (${[...effective].join(', ')}); org "${orgId}" is not one of them. ` +
				'Change the working scope in VS Code (Rewst Buddy: Set Working Scope), or set rewst-buddy.mcp.workingOrgScope to "writes" to read across orgs.',
		);
	}
}

function writeOutOfScopeMessage(orgId: string, effective: Set<string>): string {
	if (effective.size === 0) {
		return (
			`No working org is set, so writes are not allowed (attempted org "${orgId}"). ` +
			'Set one in VS Code (Rewst Buddy: Set Working Scope), or add it to rewst-buddy.mcp.alwaysAllowedOrgs.'
		);
	}
	return (
		`Writes are scoped to ${[...effective].join(', ')}; org "${orgId}" is not in scope. ` +
		'Change the working scope in VS Code (Rewst Buddy: Set Working Scope) to write to a different org.'
	);
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
	// When the org is omitted and exactly one working org is pinned, target it —
	// the model never has to name it and so cannot misname it.
	const workingOrgs = WorkingScopeManager.getOrgs();
	const soleWorkingOrg = workingOrgs.length === 1 ? workingOrgs[0] : undefined;
	const orgId = asString(args, 'orgId') ?? requestOrgId ?? soleWorkingOrg;
	if (!orgId) {
		throw new McpError('org_required', 'This tool requires an "orgId" argument. Call list_orgs to find one.');
	}
	// Surface the resolved org back into the arguments so capabilities that read
	// `orgId` from their input (the common case) see the injected working org.
	args.orgId = orgId;
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
		// Reject an out-of-scope call before the capability runs (and before any
		// approval modal, which may never surface to an external MCP client).
		assertScopeAllowed(capability, ctx.orgId, args, settings);
		try {
			// Tag the in-flight call with its origin so the deep approval modal can
			// name the caller (the chat vs an external MCP client).
			const text = await runWithApprovalOrigin(params.origin ?? 'mcp', () => capability.run(args, ctx));
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
	// Resources run read capabilities directly, so honour the working scope here too.
	assertScopeAllowed(capability, ctx.orgId, args, settings);
	const text = formatMcpOutput(toolName, await capability.run(args, ctx));
	log.info(`MCP readResource: ${uri}`);
	return { uri, mimeType: 'text/plain', text };
}

/** Exposed for tests: resets the throttle window. */
export function _resetMcpThrottleForTesting(): void {
	(THROTTLE as unknown as { hits: number[] }).hits.length = 0;
}
