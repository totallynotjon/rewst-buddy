import { approveMutationScope, isMutationScopeApproved, type MutationScope } from '../ui/chat/tools/graphqlTool';
import type { CapabilityContext } from './Capability';
import { requestMcpMutationApproval } from './graphqlMutateCapability';

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
			'The mutation was not run. The user must approve it in VS Code (a modal appears in their editor); retry after they approve.',
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

/** Runs a mutation behind the shared per-call approval flow. */
export async function withMutationApproval(
	scope: MutationScope,
	operationSummary: string,
	run: () => Promise<string>,
): Promise<string> {
	if (!isMutationScopeApproved(scope)) {
		if (!(await requestMcpMutationApproval(scope, operationSummary))) {
			return approvalRequiredResult();
		}
		approveMutationScope(scope);
	}
	return run();
}

/** Throws with the serialized GraphQL errors when a rawGraphql call failed. */
export function throwOnGraphqlErrors(errors: unknown): void {
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
}
