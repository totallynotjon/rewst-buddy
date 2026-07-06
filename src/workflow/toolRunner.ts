import { type GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import { asStringArg, type ToolRequest } from '../ui/chat/tools/toolProtocol';
import {
	runExecutionLogs,
	runRenderJinja,
	runWorkflowDiagnose,
	runWorkflowExecutions,
	runWorkflowRun,
} from './executions';
import { applyWorkflowMutation, requireScopeFields, type WorkflowOperation } from './graphMutations';
import { runWorkflowSearch } from './searchIndex';
import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_DIAGNOSE_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
} from './specs';
import { runActionSearch, runWorkflowGet } from './workflowAdapter';

function requireDeps(deps: GraphqlToolDeps | undefined): GraphqlToolDeps {
	if (!deps) {
		throw new Error('No active Rewst session for the workflow tools. Sign in to Rewst in VS Code and retry.');
	}
	return deps;
}

export async function runWorkflowTool(request: ToolRequest, deps: GraphqlToolDeps | undefined): Promise<string> {
	const bound = requireDeps(deps);
	switch (request.tool) {
		case 'buddy_workflow_get':
			return runWorkflowGet(request, bound);
		case 'buddy_action_search':
			return runActionSearch(request, bound);
		case 'buddy_render_jinja':
			return runRenderJinja(request, bound);
		case WORKFLOW_EDIT_TOOL_NAME: {
			const { workflowId, orgId } = requireScopeFields(WORKFLOW_EDIT_TOOL_NAME, request.args);
			const operations = request.args.operations;
			if (!Array.isArray(operations) || operations.length === 0) {
				throw new Error('buddy_workflow_edit requires a non-empty "operations" array.');
			}
			const comment = asStringArg(request.args, 'comment') ?? 'Edited by Cage-Free Rewsty';
			return applyWorkflowMutation(bound, workflowId, orgId, operations as WorkflowOperation[], comment);
		}
		case WORKFLOW_AUTOLAYOUT_TOOL_NAME: {
			const { workflowId, orgId } = requireScopeFields(WORKFLOW_AUTOLAYOUT_TOOL_NAME, request.args);
			const comment = asStringArg(request.args, 'comment') ?? 'Auto-laid out by Cage-Free Rewsty';
			return applyWorkflowMutation(bound, workflowId, orgId, [{ op: 'autolayout' }], comment);
		}
		case WORKFLOW_RUN_TOOL_NAME:
			return runWorkflowRun(request, bound);
		case 'buddy_workflow_executions':
			return runWorkflowExecutions(request, bound);
		case WORKFLOW_EXECUTION_LOGS_TOOL_NAME:
			return runExecutionLogs(request, bound);
		case WORKFLOW_DIAGNOSE_TOOL_NAME:
			return runWorkflowDiagnose(request, bound);
		case WORKFLOW_SEARCH_TOOL_NAME:
			return runWorkflowSearch(request, bound);
		default:
			throw new Error(`Unknown workflow tool "${request.tool}".`);
	}
}
