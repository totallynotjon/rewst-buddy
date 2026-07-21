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
import { workflowEditScope, type WorkflowMutationScope } from '../../../workflow/mutationScope';
import { workflowToolAlwaysPrompts } from '../../../workflow/specs';
import { asObject, str } from '../../../workflow/types';
import { isMutationScopeApproved } from './graphqlTool';

// ---------------------------------------------------------------------------
// Re-exports: specs
// ---------------------------------------------------------------------------
export {
	isWorkflowTool,
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_DIAGNOSE_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_TOOL_NAMES,
	WORKFLOW_TOOL_SPECS,
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
// Re-exports: mutation scope helpers
// ---------------------------------------------------------------------------
export { workflowEditScope } from '../../../workflow/mutationScope';

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
	runWorkflowDiagnose,
	runWorkflowExecutions,
	runWorkflowRun,
} from '../../../workflow/executions';

// ---------------------------------------------------------------------------
// Re-exports: adapter (workflow_get + action_search)
// ---------------------------------------------------------------------------
export { runWorkflowTool } from '../../../workflow/toolRunner';
export { runActionSearch, runWorkflowGet, summarizeWorkflow } from '../../../workflow/workflowAdapter';

// ---------------------------------------------------------------------------
// workflowEditConfirmation — approval prompt text for the UI adapter
// ---------------------------------------------------------------------------

export interface WorkflowConfirmation extends WorkflowMutationScope {
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
		const section = str(args.section);
		message = section
			? `Auto-layout a section of "${scope.scopeName}" around "${section}" — re-arranges only that single-entry/single-exit chunk and shifts the surrounding tasks to fit.`
			: `Auto-layout "${scope.scopeName}" — re-arranges every task into a clean top-down layout.`;
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
