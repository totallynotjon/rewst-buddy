/**
 * Thin adapter layer — re-exports from src/workflow/ modules.
 *
 * All logic has been extracted to:
 *   src/workflow/types.ts          — shared raw interfaces + cross-cutting utils
 *   src/workflow/specs.ts          — tool-spec prose and ToolSpec literals
 *   src/workflow/graphMutations.ts — 11-op edit engine + workflowToInput
 *   src/workflow/layout.ts         — auto-layout algorithm
 *   src/workflow/searchIndex.ts    — paginated workflow search index
 *   src/workflow/executions.ts     — execution logs, run-poll, render-jinja
 *   src/workflow/workflowAdapter.ts — action-search + buddy_workflow_get runners
 *
 * This file is kept as the public surface so existing imports don't break.
 * See epic issue #129 (D1) for the full split rationale.
 */

import { type WorkflowOperation } from '../../../workflow/graphMutations';
import { workflowToolAlwaysPrompts } from '../../../workflow/specs';
import { asObject, str } from '../../../workflow/types';
import { type GraphqlToolDeps, type MutationScope, isMutationScopeApproved } from './graphqlTool';
import { type ToolRequest } from './toolProtocol';

// ---------------------------------------------------------------------------
// Re-exports: specs
// ---------------------------------------------------------------------------
export {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_TOOL_NAMES,
	WORKFLOW_TOOL_SPECS,
	isWorkflowTool,
	workflowToolAlwaysPrompts,
} from '../../../workflow/specs';

// ---------------------------------------------------------------------------
// Re-exports: edit engine
// ---------------------------------------------------------------------------
export {
	applyOperations,
	applyWorkflowMutation,
	requireScopeFields,
	sentValueDivergences,
	workflowToInput,
	type WorkflowOperation,
} from '../../../workflow/graphMutations';
export { normalizePublish } from '../../../workflow/types';

// ---------------------------------------------------------------------------
// Re-exports: layout
// ---------------------------------------------------------------------------
export { autoLayout } from '../../../workflow/layout';

// ---------------------------------------------------------------------------
// Re-exports: search index
// ---------------------------------------------------------------------------
export { _resetWorkflowIndexForTesting } from '../../../workflow/searchIndex';

// ---------------------------------------------------------------------------
// Re-exports: executions
// ---------------------------------------------------------------------------
export {
	assertExecutionBelongsToOrg,
	fetchTaskLogs,
	formatTaskLogs,
	isFailedStatus,
	runExecutionLogs,
	runRenderJinja,
	runWorkflowExecutions,
	runWorkflowRun,
} from '../../../workflow/executions';

// ---------------------------------------------------------------------------
// Re-exports: adapter (workflow_get + action_search)
// ---------------------------------------------------------------------------
export { runActionSearch, runWorkflowGet, summarizeWorkflow } from '../../../workflow/workflowAdapter';

// ---------------------------------------------------------------------------
// workflowEditScope — approval scope extractor (stays here as it uses
// MutationScope from graphqlTool, a UI-layer type)
// ---------------------------------------------------------------------------

const WORKFLOW_MUTATION_TOOLS = new Set<string>([
	'buddy_workflow_edit',
	'buddy_workflow_autolayout',
	'buddy_workflow_run',
]);

export function workflowEditScope(name: string, input: unknown): MutationScope | undefined {
	if (!WORKFLOW_MUTATION_TOOLS.has(name)) return undefined;
	const args = asObject(input);
	const workflowId = str(args.workflowId);
	const workflowName = str(args.workflowName);
	const orgId = str(args.orgId);
	const orgName = str(args.orgName);
	if (!workflowId || !workflowName || !orgId || !orgName) return undefined;
	return { scopeId: workflowId, scopeName: workflowName, orgId, orgName };
}

export interface WorkflowConfirmation extends MutationScope {
	message: string;
}

/**
 * workflowEditConfirmation — returns a human-readable confirmation prompt for
 * a workflow mutation, or undefined if the scope is already approved this
 * session. Used by the approval UI and tests.
 */
export function workflowEditConfirmation(name: string, input: unknown): WorkflowConfirmation | undefined {
	const scope = workflowEditScope(name, input);
	if (!scope) return undefined;
	if (!workflowToolAlwaysPrompts(name) && isMutationScopeApproved(scope)) return undefined;
	const args = asObject(input);
	let message: string;
	if (name === 'buddy_workflow_autolayout') {
		message = `Auto-layout "${scope.scopeName}" — re-arranges every task into a clean top-down layout.`;
	} else if (name === 'buddy_workflow_run') {
		message = `Run workflow "${scope.scopeName}" — executes the workflow's automation.`;
	} else {
		const operations = Array.isArray(args.operations) ? (args.operations as WorkflowOperation[]) : [];
		const summary = operations
			.slice(0, 3)
			.map(op => `${op.op}${str(op.name) ? ` ${str(op.name)}` : ''}`)
			.join(', ');
		const more = operations.length > 3 ? ` (+${operations.length - 3} more)` : '';
		message = `Edit "${scope.scopeName}": ${summary}${more}`;
	}
	return { ...scope, message };
}

// ---------------------------------------------------------------------------
// runWorkflowTool — single dispatch entry point
// ---------------------------------------------------------------------------

import { runExecutionLogs, runRenderJinja, runWorkflowExecutions, runWorkflowRun } from '../../../workflow/executions';
import { applyWorkflowMutation, requireScopeFields } from '../../../workflow/graphMutations';
import { runWorkflowSearch } from '../../../workflow/searchIndex';
import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
} from '../../../workflow/specs';
import { runActionSearch, runWorkflowGet } from '../../../workflow/workflowAdapter';
import { asStringArg } from './toolProtocol';

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
		case WORKFLOW_SEARCH_TOOL_NAME:
			return runWorkflowSearch(request, bound);
		default:
			throw new Error(`Unknown workflow tool "${request.tool}".`);
	}
}
