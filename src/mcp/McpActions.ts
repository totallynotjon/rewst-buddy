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
 * Org-agnostic discovery tools (requiresOrg:false, e.g. buddy_list_orgs, the working-
 * scope tools) are never gated, so the user can always find an org and pin it.
 */
function assertScopeAllowed(
	capability: Capability,
	orgId: string,
	args: Record<string, unknown>,
	settings: McpSettings,
): void {
	if (capability.requiresOrg === false) {
		// An org-optional read that reaches into org data by a globally unique id
		// (scopedSessions, e.g. buddy_execution_logs) still honours strict read
		// scope when the caller names an org; discovery tools stay ungated.
		const requested = asString(args, 'orgId');
		if (capability.scopedSessions && requested && strictReadScopeActive(settings)) {
			const effective = effectiveAllowedOrgs(settings);
			if (!effective.has(requested)) {
				throw new McpError('org_out_of_scope', readOutOfScopeMessage(requested, effective));
			}
		}
		return;
	}
	const effective = effectiveAllowedOrgs(settings);
	const workingOrgs = WorkingScopeManager.getOrgs();

	if (capability.access === 'write') {
		if (!effective.has(orgId)) {
			throw new McpError('org_out_of_scope', writeOutOfScopeMessage(orgId, effective));
		}
		const workflows = WorkingScopeManager.getWorkflows();
		if (workflows.length > 0) {
			// buddy_graphql_mutate names its workflow target via scopeId/scopeName, so
			// resolve from both — otherwise a mutation against another workflow in an
			// allowed org would slip past this gate.
			const scopeName = asString(args, 'scopeName');
			const workflowId =
				asString(args, 'workflowId') ??
				(scopeName?.toLowerCase() === 'workflow' ? asString(args, 'scopeId') : undefined);
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
		throw new McpError('org_out_of_scope', readOutOfScopeMessage(orgId, effective));
	}
}

/** Whether strict read scoping is in force: strict mode with a working org pinned. */
function strictReadScopeActive(settings: McpSettings): boolean {
	return settings.workingOrgScope === 'strict' && WorkingScopeManager.getOrgs().length > 0;
}

function readOutOfScopeMessage(orgId: string, effective: Set<string>): string {
	return (
		`Reads are scoped to the working orgs (${[...effective].join(', ')}); org "${orgId}" is not one of them. ` +
		'Change the working scope in VS Code (Rewst Buddy: Set Working Scope), or set rewst-buddy.mcp.workingOrgScope to "writes" to read across orgs.'
	);
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

/**
 * Determines which org id a capability call targets — a pure, no-I/O
 * computation safe to run before the scope gate. Throws org_required for an
 * org-scoped capability with no resolvable org id, mirroring the priority the
 * old single-pass resolveContext gave that check.
 */
function resolveOrgId(
	capability: Capability,
	args: Record<string, unknown>,
	requestOrgId: string | undefined,
	settings: McpSettings,
): string | undefined {
	if (capability.requiresOrg === false) {
		if (!capability.scopedSessions) return undefined;
		const requested = asString(args, 'orgId') ?? requestOrgId;
		if (requested) {
			args.orgId = requested;
			return requested;
		}
		if (strictReadScopeActive(settings)) {
			const workingOrgs = WorkingScopeManager.getOrgs();
			if (workingOrgs.length === 1) {
				args.orgId = workingOrgs[0];
				return workingOrgs[0];
			}
			throw new McpError(
				'org_required',
				'This tool reads org-owned execution data by id and requires "orgId" when strict working-org scope has multiple orgs pinned.',
			);
		}
		return undefined;
	}
	// When the org is omitted and exactly one working org is pinned, target it —
	// the model never has to name it and so cannot misname it.
	const workingOrgs = WorkingScopeManager.getOrgs();
	const soleWorkingOrg = workingOrgs.length === 1 ? workingOrgs[0] : undefined;
	const orgId = asString(args, 'orgId') ?? requestOrgId ?? soleWorkingOrg;
	if (!orgId) {
		throw new McpError('org_required', 'This tool requires an "orgId" argument. Call buddy_list_orgs to find one.');
	}
	// Surface the resolved org back into the arguments so capabilities that read
	// `orgId` from their input (the common case) see the injected working org.
	args.orgId = orgId;
	return orgId;
}

/**
 * Resolves the session + org context a capability runs against, given the org
 * id resolveOrgId already cleared through the scope gate. Session lookup may
 * run a cached (normally free; network only once the 24h validation cache has
 * expired) validity check via SessionManager.getSessionForOrg, so an org whose
 * only registered session has gone stale falls through to another session
 * that still manages it rather than erroring. Callers MUST run this only
 * after assertScopeAllowed (see callTool/readResource), so an out-of-scope
 * request never triggers authenticated Rewst traffic.
 */
async function resolveContext(
	capability: Capability,
	args: Record<string, unknown>,
	orgId: string | undefined,
	settings: McpSettings,
): Promise<CapabilityContext> {
	const sessions = SessionManager.getActiveSessions();
	if (sessions.length === 0) {
		throw new McpError(
			'no_session',
			'No Rewst sessions are active. Open VS Code with Rewst Buddy and sign in, then retry.',
		);
	}
	if (capability.requiresOrg === false) {
		const scoped = scopedSessionsFor(capability, sessions, settings);
		if (scoped.length === 0) {
			throw new McpError(
				'no_session',
				'No active session manages an org in the working scope. Sign in to that account in VS Code, or change the working scope (Rewst Buddy: Set Working Scope).',
			);
		}
		return { session: scoped[0], orgId: scoped[0].profile.org.id, sessions: scoped };
	}
	// orgId is guaranteed defined here: resolveOrgId already threw org_required
	// otherwise, for every capability whose requiresOrg is not false.
	let session: Session;
	try {
		session = await SessionManager.getSessionForOrg(orgId as string);
	} catch {
		throw new McpError(
			'org_not_found',
			`No active session manages org "${orgId}". Call buddy_list_orgs for valid ids.`,
		);
	}
	return { session, orgId: orgId as string, sessions };
}

/**
 * The sessions a requiresOrg:false capability may touch: all of them, except
 * that a scopedSessions capability (org data read by globally unique id) under
 * strict read scope is narrowed to sessions managing an org in the effective
 * allowed set — otherwise its cross-session sweep would let a scoped caller
 * probe data in orgs the working scope excludes.
 */
function scopedSessionsFor(capability: Capability, sessions: Session[], settings: McpSettings): Session[] {
	if (!capability.scopedSessions || !strictReadScopeActive(settings)) return sessions;
	const effective = effectiveAllowedOrgs(settings);
	return sessions.filter(
		session =>
			effective.has(session.profile.org.id) || session.profile.allManagedOrgs.some(org => effective.has(org.id)),
	);
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
		const orgId = resolveOrgId(capability, args, params.orgId, settings);
		auditOrgId =
			capability.requiresOrg === false ? (capability.scopedSessions && orgId ? orgId : '—') : orgId || '—';
		// Reject an out-of-scope call before the capability runs (and before any
		// approval modal, which may never surface to an external MCP client), and
		// before resolving a session for it — an out-of-scope orgId must never
		// trigger authenticated Rewst traffic.
		assertScopeAllowed(capability, orgId ?? '', args, settings);
		const ctx = await resolveContext(capability, args, orgId, settings);
		// Validate/refresh the session only after the scope gate passes, so an
		// out-of-scope request triggers no authenticated Rewst traffic.
		if (capability.requiresOrg !== false) await ensureValidSession(ctx.session);
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
	const templatesExposed = isCapabilityExposed('buddy_list_templates', settings);
	const workflowsExposed = isCapabilityExposed('buddy_list_workflows', settings);
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
				? 'buddy_get_template'
				: 'buddy_list_templates'
			: parsed.id
				? 'buddy_get_workflow'
				: 'buddy_list_workflows';
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
	const orgId = resolveOrgId(capability, args, parsed.orgId, settings);
	// Resources run read capabilities directly, so honour the working scope here too,
	// and before resolving a session — an out-of-scope orgId must never trigger
	// authenticated Rewst traffic.
	assertScopeAllowed(capability, orgId ?? '', args, settings);
	const ctx = await resolveContext(capability, args, orgId, settings);
	await ensureValidSession(ctx.session);
	const text = formatMcpOutput(toolName, await capability.run(args, ctx));
	log.info(`MCP readResource: ${uri}`);
	return { uri, mimeType: 'text/plain', text };
}

/** Exposed for tests: resets the throttle window. */
export function _resetMcpThrottleForTesting(): void {
	(THROTTLE as unknown as { hits: number[] }).hits.length = 0;
}
