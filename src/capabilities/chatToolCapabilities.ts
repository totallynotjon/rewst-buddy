import { createGraphqlDeps } from '../ui/chat/tools/graphqlTool';
import { RESULT_READ_TOOL_SPECS } from '../ui/chat/tools/toolOutputCache';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import { WEB_TOOL_SPECS } from '../ui/chat/tools/webTools';
import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_TOOL_SPECS,
} from '../ui/chat/tools/workflowTools';
import { runToolRequests, WORKSPACE_TOOL_SPECS } from '../ui/chat/tools/workspaceTools';
import type { Capability, CapabilityAccess, CapabilityContext, CapabilitySettings } from './Capability';

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
	'web_search',
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	'buddy_result_read',
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

function chatCapability(
	spec: ToolSpec,
	access: CapabilityAccess,
	enabled: (settings: CapabilitySettings) => boolean,
): Capability {
	return {
		spec,
		access,
		chat: true,
		mcp: false,
		...(doesNotRequireOrg.has(spec.name) ? { requiresOrg: false as const } : {}),
		enabled,
		run: (input, ctx) => runViaChatToolPath(spec, input, ctx),
	};
}

export const WORKSPACE_CHAT_CAPABILITIES: Capability[] = WORKSPACE_TOOL_SPECS.map(spec =>
	chatCapability(spec, 'read', settings => settings.enableWorkspaceTools),
);

export const WEB_CHAT_CAPABILITIES: Capability[] = WEB_TOOL_SPECS.map(spec =>
	chatCapability(spec, 'read', settings => settings.enableWebTools),
);

export const WORKFLOW_CHAT_CAPABILITIES: Capability[] = WORKFLOW_TOOL_SPECS.map(spec =>
	chatCapability(spec, workflowAccessFor(spec), settings => settings.enableWorkflowTools),
);

export const RESULT_READ_CHAT_CAPABILITIES: Capability[] = RESULT_READ_TOOL_SPECS.map(spec =>
	chatCapability(
		spec,
		'read',
		settings =>
			settings.enableWorkspaceTools ||
			settings.enableWebTools ||
			settings.enableGraphqlTool ||
			settings.enableWorkflowTools,
	),
);
