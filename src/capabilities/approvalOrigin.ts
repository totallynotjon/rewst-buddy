import { AsyncLocalStorage } from 'async_hooks';

/**
 * Who initiated a capability call, used only for the mutation-approval modal
 * wording so the user can see whether the request came from the in-process
 * Cage-Free Rewsty chat or an external MCP client. The actual write gates
 * (enableWriteTools/allowlist/approve-or-deny) do not depend on this — it is a
 * label, not a gate.
 *
 * It rides an async-local context set once at the McpActions.callTool choke
 * point, so the deep approval call (requestMcpMutationApproval) can read it
 * without threading an argument through every write capability.
 */
export type ApprovalOrigin = 'chat' | 'mcp';

const store = new AsyncLocalStorage<ApprovalOrigin>();

/** Runs fn with the given approval origin in scope for the approval flow to read. */
export function runWithApprovalOrigin<T>(origin: ApprovalOrigin, fn: () => Promise<T>): Promise<T> {
	return store.run(origin, fn);
}

/** The in-flight call's origin; defaults to an external MCP client when unset. */
export function currentApprovalOrigin(): ApprovalOrigin {
	return store.getStore() ?? 'mcp';
}
