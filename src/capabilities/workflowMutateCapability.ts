import {
	approveMutationScope,
	createGraphqlDeps,
	isMutationScopeApproved,
	type MutationScope,
} from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	runWorkflowTool,
	workflowEditScope,
	workflowToolAlwaysPrompts,
} from '../ui/chat/tools/workflowTools';
import type { CapabilityContext } from './Capability';
import { requestMcpMutationApproval } from './graphqlMutateCapability';

function approvalRequiredResult(): string {
	return JSON.stringify({
		status: 'approval_required',
		message:
			'The mutation was not run; it needs approval in the VS Code window running Rewst Buddy. Focus that window to respond to the prompt, then retry. The prompt does not appear in the MCP client and cannot be approved if no VS Code window is open.',
	});
}

function missingScopeResult(toolName: string): string {
	return JSON.stringify({
		status: 'invalid_request',
		message: `${toolName} requires non-empty workflowId, workflowName, orgId, and orgName before it can request approval.`,
	});
}

function approvalVerb(toolName: string): string {
	if (toolName === WORKFLOW_AUTOLAYOUT_TOOL_NAME) return 'Auto-layout';
	if (toolName === WORKFLOW_RUN_TOOL_NAME) return 'Run';
	return 'Edit';
}

function operationSummary(toolName: string, scope: MutationScope): string {
	const verb = approvalVerb(toolName);
	return `${verb} workflow "${scope.scopeName}" (${scope.scopeId}) in org "${scope.orgName}" (${scope.orgId})`;
}

export async function runWorkflowMutationWithApproval(
	spec: ToolSpec,
	input: Record<string, unknown>,
	ctx: CapabilityContext,
): Promise<string> {
	const scope = workflowEditScope(spec.name, input);
	if (!scope) return missingScopeResult(spec.name);

	const alwaysPrompt = workflowToolAlwaysPrompts(spec.name);
	if (alwaysPrompt || !isMutationScopeApproved(scope)) {
		if (!(await requestMcpMutationApproval(scope, operationSummary(spec.name, scope)))) {
			return approvalRequiredResult();
		}
		if (!alwaysPrompt) approveMutationScope(scope);
	}

	return runWorkflowTool({ tool: spec.name, args: input }, createGraphqlDeps(ctx.session));
}
