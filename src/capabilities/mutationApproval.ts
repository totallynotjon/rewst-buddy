import { approveMutationScope, isMutationScopeApproved, type MutationScope } from '../ui/chat/tools/graphqlTool';
import type { CapabilityContext } from './Capability';
import { requestMcpMutationApproval } from './graphqlMutateCapability';
export { throwOnGraphqlErrors } from './inputHelpers';

/**
 * Shared plumbing for the org-scoped write capabilities (templates, org
 * variables, tags, …). Every write routes through the same per-call VS Code
 * approval the workflow write tools use, and reports the org being changed by the
 * requested orgId rather than the session's primary org.
 */

/** The standard "not run, awaiting approval" result write tools return on deny. */
export function approvalRequiredResult(): string {
	return JSON.stringify({
		status: 'approval_required',
		message:
			'The mutation was not run; it needs approval in the VS Code window running Rewst Buddy. Focus that window to respond to the prompt, then retry. The prompt does not appear in the MCP client and cannot be approved if no VS Code window is open.',
	});
}

/**
 * The display name of the org being mutated, resolved against the requested orgId
 * rather than the session's primary org — one session can manage several orgs, so
 * profile.org is not necessarily the requested one. Used only for the approval
 * modal text; scoping itself is by the authoritative orgId.
 */
export function orgDisplayName(ctx: CapabilityContext): string {
	const { profile } = ctx.session;
	if (profile.org.id === ctx.orgId) return profile.org.name;
	const managed = profile.allManagedOrgs.find(org => org.id === ctx.orgId);
	return managed?.name ?? ctx.orgId;
}

/**
 * Runs a mutation behind the shared per-call approval flow. With alwaysPrompt
 * (e.g. workflow run/auto-layout) the prompt shows on every call and approval is
 * never remembered for the scope.
 */
export async function withMutationApproval(
	scope: MutationScope,
	operationSummary: string,
	run: () => Promise<string>,
	opts: { alwaysPrompt?: boolean } = {},
): Promise<string> {
	if (opts.alwaysPrompt || !isMutationScopeApproved(scope)) {
		if (!(await requestMcpMutationApproval(scope, operationSummary))) {
			return approvalRequiredResult();
		}
		if (!opts.alwaysPrompt) approveMutationScope(scope);
	}
	return run();
}
