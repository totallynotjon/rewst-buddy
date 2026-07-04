import type { Session } from '@sessions';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';

/**
 * A capability is one Rewst operation defined once and exposed on every surface
 * that wants it. The registry (registry.ts) is the single source of truth; each
 * surface is a thin adapter that filters the registry by its own gates and runs
 * the handler. Rewst-contributed operations are currently exposed over MCP, not
 * as VS Code language-model chat tools.
 *
 * The handler receives a session that was already resolved and validated by the
 * surface — never raw secrets. Cookies stay inside the extension host; the MCP
 * server (also in the host) receives only tool names and arguments from clients.
 */

export type CapabilityAccess = 'read' | 'write';

/**
 * The session + org a capability handler runs against. The surface resolves and
 * validates the session before calling run, so handlers can assume it is live.
 * `sessions` is every active session, for org-discovery capabilities that span
 * orgs (e.g. buddy_list_orgs) and so do not depend on `session`/`orgId`.
 */
export interface CapabilityContext {
	session: Session;
	orgId: string;
	sessions: Session[];
}

export interface Capability {
	spec: ToolSpec;
	/**
	 * Whether the capability can change Rewst state. The MCP server boundary
	 * rejects access:'write' unless write tools are explicitly enabled, regardless
	 * of what the client requests.
	 */
	access: CapabilityAccess;
	/** High-risk write capability that has its own MCP exposure toggle. */
	dangerous?: boolean;
	/**
	 * Whether the capability operates on a specific org. When false (e.g.
	 * buddy_list_orgs), the MCP surface does not require an `orgId` argument and the
	 * handler should use `ctx.sessions` rather than `ctx.session`. Defaults to
	 * org-scoped (true) when omitted.
	 */
	requiresOrg?: boolean;
	/**
	 * Only meaningful with requiresOrg:false. Marks a capability that reads
	 * org-owned data by a globally unique id (e.g. buddy_execution_logs) rather
	 * than discovering orgs. Under strict working-org scope with a working org
	 * pinned, the MCP boundary narrows `ctx.sessions` to sessions managing an org
	 * in the effective allowed set and rejects an explicitly supplied `orgId`
	 * outside that set — discovery tools stay unscoped.
	 */
	scopedSessions?: boolean;
	/** Runs the operation and returns text for the caller. */
	run(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string>;
}
