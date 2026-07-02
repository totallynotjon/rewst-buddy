import { createGraphqlDeps, type GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
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
	'buddy_search_template_links',
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
	deps: GraphqlToolDeps = createGraphqlDeps(ctx.session),
): Promise<string> {
	const [result] = await runToolRequests([{ tool: spec.name, args: input }], undefined, undefined, deps);
	return result.ok ? result.output : `Error: ${result.output}`;
}

/**
 * Deps for buddy_execution_logs, which resolves an execution by its globally
 * unique id and carries no required org. requiresOrg:false capabilities run
 * against the first active session, but each session only sees its own org
 * hierarchy — an execution owned by another signed-in account would come back
 * empty (#116). So: an optional orgId routes the primary to the session
 * managing that org, and the other sessions ride along as alternates for the
 * tool's empty-result sweep. Both primary and alternates come only from
 * ctx.sessions, which the MCP boundary has already narrowed to the working
 * scope for this scopedSessions capability (see McpActions), so the sweep
 * cannot reach a session the scope excludes.
 */
export async function executionLogsDeps(
	input: Record<string, unknown>,
	ctx: CapabilityContext,
): Promise<GraphqlToolDeps> {
	const orgId = typeof input.orgId === 'string' && input.orgId ? input.orgId : undefined;
	const primary = orgId
		? (ctx.sessions.find(
				session =>
					session.profile.org.id === orgId || session.profile.allManagedOrgs.some(org => org.id === orgId),
			) ?? ctx.session)
		: ctx.session;
	const deps = createGraphqlDeps(primary);
	deps.alternates = ctx.sessions.filter(session => session !== primary).map(createGraphqlDeps);
	return deps;
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
	if (access === 'write') {
		return mcpCapability(spec, access, 'workflow', true, (input, ctx) =>
			runWorkflowMutationWithApproval(spec, input, ctx),
		);
	}
	if (spec.name === WORKFLOW_EXECUTION_LOGS_TOOL_NAME) {
		return {
			...mcpCapability(spec, access, 'workflow', true, async (input, ctx) =>
				runViaChatToolPath(spec, input, ctx, await executionLogsDeps(input, ctx)),
			),
			// Org data read by globally unique id: the MCP boundary narrows its
			// session sweep to the working scope under strict read scoping.
			scopedSessions: true,
		};
	}
	return mcpCapability(spec, access, 'workflow', true);
});
