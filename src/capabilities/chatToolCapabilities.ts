import { createGraphqlDeps } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_TOOL_SPECS,
} from '../ui/chat/tools/workflowTools';
import { runToolRequests, WORKSPACE_TOOL_SPECS } from '../ui/chat/tools/workspaceTools';
import type { Capability, CapabilityAccess, CapabilityContext, CapabilityGroup } from './Capability';
import { runWorkflowMutationWithApproval } from './workflowMutateCapability';

const workflowAccess: Record<string, CapabilityAccess> = {
	buddy_workflow_get: 'read',
	[WORKFLOW_SEARCH_TOOL_NAME]: 'read',
	buddy_action_search: 'read',
	[WORKFLOW_EDIT_TOOL_NAME]: 'write',
	[WORKFLOW_AUTOLAYOUT_TOOL_NAME]: 'write',
	[WORKFLOW_RUN_TOOL_NAME]: 'write',
	buddy_workflow_executions: 'read',
	[WORKFLOW_EXECUTION_LOGS_TOOL_NAME]: 'read',
	buddy_render_jinja: 'read',
};

const doesNotRequireOrg = new Set<string>([
	'list_template_links',
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
]);

function workflowAccessFor(spec: ToolSpec): CapabilityAccess {
	const access = workflowAccess[spec.name];
	if (!access) throw new Error(`chatToolCapabilities: missing access classification for "${spec.name}"`);
	return access;
}

async function runViaChatToolPath(
	spec: ToolSpec,
	input: Record<string, unknown>,
	ctx: CapabilityContext,
): Promise<string> {
	const [result] = await runToolRequests(
		[{ tool: spec.name, args: input }],
		undefined,
		undefined,
		createGraphqlDeps(ctx.session),
	);
	return result.ok ? result.output : `Error: ${result.output}`;
}

function mcpCapability(
	spec: ToolSpec,
	access: CapabilityAccess,
	group: CapabilityGroup,
	mcp: boolean,
	run: (input: Record<string, unknown>, ctx: CapabilityContext) => Promise<string> = (input, ctx) =>
		runViaChatToolPath(spec, input, ctx),
): Capability {
	return {
		spec,
		group,
		access,
		chat: false,
		mcp,
		...(doesNotRequireOrg.has(spec.name) ? { requiresOrg: false as const } : {}),
		run,
	};
}

export const WORKSPACE_CHAT_CAPABILITIES: Capability[] = WORKSPACE_TOOL_SPECS.map(spec =>
	mcpCapability(spec, 'read', 'workspace', true),
);

export const WORKFLOW_CHAT_CAPABILITIES: Capability[] = WORKFLOW_TOOL_SPECS.map(spec => {
	const access = workflowAccessFor(spec);
	return access === 'write'
		? mcpCapability(spec, access, 'workflow', true, (input, ctx) =>
				runWorkflowMutationWithApproval(spec, input, ctx),
			)
		: mcpCapability(spec, access, 'workflow', true);
});
