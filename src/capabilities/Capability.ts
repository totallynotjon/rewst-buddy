import type { Session } from '@sessions';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';

/**
 * A capability is one Rewst operation defined once and exposed on every surface
 * that wants it (the Cage-Free Rewsty chat tools and the MCP server). The
 * registry (registry.ts) is the single source of truth; each surface is a thin
 * adapter that filters the registry by its own gates and runs the handler.
 *
 * The handler receives a session that was already resolved and validated by the
 * surface — never raw secrets. Cookies stay inside the extension host; the MCP
 * server (also in the host) receives only tool names and arguments from clients.
 */

export type CapabilityAccess = 'read' | 'write';

/**
 * Settings that gate whether a capability is offered at all, independent of
 * any surface. Each field mirrors one rewst-buddy.ai.tools category. The MCP
 * surface layers its own gates on top (master switch, write toggle, allowlist).
 */
export interface CapabilitySettings {
	enableGraphqlTool: boolean;
	enableWorkflowTools: boolean;
	enableWebTools: boolean;
	enableWorkspaceTools: boolean;
}

/**
 * The session + org a capability handler runs against. The surface resolves and
 * validates the session before calling run, so handlers can assume it is live.
 * `sessions` is every active session, for org-discovery capabilities that span
 * orgs (e.g. list_orgs) and so do not depend on `session`/`orgId`.
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
	/** Exposed as a Cage-Free Rewsty chat tool (vscode-tool protocol). */
	chat: boolean;
	/** Exposed over the MCP server surface. */
	mcp: boolean;
	/**
	 * Whether the capability operates on a specific org. When false (e.g.
	 * list_orgs), the MCP surface does not require an `orgId` argument and the
	 * handler should use `ctx.sessions` rather than `ctx.session`. Defaults to
	 * org-scoped (true) when omitted.
	 */
	requiresOrg?: boolean;
	/** Intrinsic feature gate; surface-specific gates are applied by the surface. */
	enabled(settings: CapabilitySettings): boolean;
	/** Runs the operation and returns text for the caller. */
	run(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string>;
}
