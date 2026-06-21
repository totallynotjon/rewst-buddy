import {
	CAPABILITY_REGISTRY,
	getCapability,
	type Capability,
	type CapabilityContext,
	type CapabilitySettings,
} from '@capabilities';
import { SessionManager, type Session } from '@sessions';
import { log } from '@utils';
import { enabledAiTools } from '../ui/chat/tools/aiToolSettings';
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

const MCP_MAX_OUTPUT_CHARS = 24_000;
// An external agent can loop fast and each call hits a real org through the
// user's cookie session, so cap MCP-originated calls independently of the chat.
const THROTTLE = new SlidingWindowThrottle(30, 10_000);

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

function capabilitySettings(): CapabilitySettings {
	const tools = enabledAiTools();
	return {
		enableGraphqlTool: tools.has('graphql'),
		enableWorkflowTools: tools.has('workflows'),
		enableWorkspaceTools: tools.has('workspace'),
	};
}

/** Whether a capability is exposed to MCP under the current settings. */
function isExposed(capability: Capability, settings: McpSettings): boolean {
	if (!capability.mcp) return false;
	if (!capability.enabled(capabilitySettings())) return false;
	if (capability.access === 'write' && !settings.enableWriteTools) return false;
	if (settings.enabledTools.length > 0 && !settings.enabledTools.includes(capability.spec.name)) return false;
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

function truncate(text: string): string {
	if (text.length <= MCP_MAX_OUTPUT_CHARS) return text;
	return `${text.slice(0, MCP_MAX_OUTPUT_CHARS)}\n…(output truncated at ${MCP_MAX_OUTPUT_CHARS} characters; narrow your request to see more)`;
}

function asString(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
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
	const capability = getCapability(params.name);
	if (!capability || !capability.mcp) {
		throw new McpError('unknown_tool', `Unknown tool "${params.name}".`);
	}
	if (capability.access === 'write' && !settings.enableWriteTools) {
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
	try {
		const text = await capability.run(args, ctx);
		log.info(`MCP callTool ok: ${params.name} org=${ctx.orgId}`);
		return { text: truncate(text) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.info(`MCP callTool error: ${params.name} org=${ctx.orgId}: ${message}`);
		// A capability that throws is a tool-execution failure the agent should
		// see, not a transport error; surface it as an isError result.
		return { text: message, isError: true };
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
	const text = truncate(await capability.run(args, ctx));
	log.info(`MCP readResource: ${uri}`);
	return { uri, mimeType: 'text/plain', text };
}

/** Exposed for tests: resets the throttle window. */
export function _resetMcpThrottleForTesting(): void {
	(THROTTLE as unknown as { hits: number[] }).hits.length = 0;
}
