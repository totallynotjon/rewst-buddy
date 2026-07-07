/**
 * Pure helpers for the Jinja preview panel's context-pick flow.
 * No VS Code QuickPick UI here — only data assembly and cache-key logic
 * that can be unit-tested without a real webview.
 */

import type { GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import type { ExecutionRow } from '../workflow/executions';
import { fetchExecutionContextSnapshots } from '../workflow/executions';
import {
	buildWorkflowIndex,
	getCachedWorkflowIndex,
	setCachedWorkflowIndex,
	workflowSearchCacheKey,
} from '../workflow/searchIndex';
import { WORKFLOW_SEARCH_TOOL_NAME } from '../workflow/specs';
import { isPlainObject } from '../workflow/types';
import type { JinjaPreviewContextEntry } from '../models/JinjaPreviewContextStore';
import vscode from 'vscode';
import { WORKFLOW_EXECUTIONS_QUERY } from '../workflow/executions';

// ---------------------------------------------------------------------------
// mergeExecutionContext
// ---------------------------------------------------------------------------

/**
 * Fetch and merge all context snapshots for an execution into one object.
 * Later snapshots win on key conflicts (same semantics as runRenderJinja).
 */
export async function mergeExecutionContext(
	deps: GraphqlToolDeps,
	executionId: string,
): Promise<Record<string, unknown>> {
	const snapshots = await fetchExecutionContextSnapshots(deps, executionId);
	return Object.assign({}, ...snapshots.filter(isPlainObject)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// buildExecutionQuickPickItems
// ---------------------------------------------------------------------------

/**
 * Convert a list of ExecutionRow objects into VS Code QuickPickItems,
 * sorted newest-first by createdAt.
 */
export function buildExecutionQuickPickItems(rows: ExecutionRow[]): vscode.QuickPickItem[] {
	const sorted = [...rows].sort((a, b) => {
		const ta = Number(a.createdAt ?? 0);
		const tb = Number(b.createdAt ?? 0);
		return tb - ta;
	});
	return sorted.map(row => ({
		label: `$(history) ${row.status ?? 'unknown'} — ${row.id ?? '?'}`,
		detail: row.createdAt ? new Date(Number(row.createdAt)).toLocaleString() : undefined,
		description: row.id ?? undefined,
	}));
}

// ---------------------------------------------------------------------------
// workflowIndexCacheKeyForPicker
// ---------------------------------------------------------------------------

/**
 * Returns the same cache key that buddy_workflow_search uses, so the picker
 * shares the warm workflow index instead of rebuilding it.
 */
export function workflowIndexCacheKeyForPicker(deps: GraphqlToolDeps): string {
	return workflowSearchCacheKey({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: {} }, deps);
}

// ---------------------------------------------------------------------------
// pickJinjaExecutionContext
// ---------------------------------------------------------------------------

/**
 * Full two-step QuickPick flow: pick a workflow, then pick an execution.
 * Returns undefined if the user cancels either step.
 */
export async function pickJinjaExecutionContext(
	deps: GraphqlToolDeps,
	orgId: string,
): Promise<JinjaPreviewContextEntry | undefined> {
	// Step 1: workflow pick — get or build the cached index.
	const cacheKey = workflowIndexCacheKeyForPicker(deps);
	let index = getCachedWorkflowIndex(cacheKey);
	if (!index) {
		index = await buildWorkflowIndex(deps);
		setCachedWorkflowIndex(cacheKey, index);
	}

	// Filter to the org, fall back to all entries if none match (cross-org sub-workflows).
	const orgEntries = index.entries.filter(e => e.orgId === orgId);
	const entries = orgEntries.length > 0 ? orgEntries : index.entries;

	const workflowItems: (vscode.QuickPickItem & { workflowId: string; workflowName: string })[] = entries.map(e => ({
		label: e.name,
		description: e.orgName !== index!.entries.find(x => x.orgId === orgId)?.orgId ? e.orgName : undefined,
		workflowId: e.id,
		workflowName: e.name,
	}));

	const pickedWorkflow = await vscode.window.showQuickPick(workflowItems, {
		placeHolder: 'Select a workflow to pick an execution context from',
		title: 'Jinja Preview: Pick Workflow',
	});
	if (!pickedWorkflow) return undefined;

	// Step 2: execution pick.
	const execResult = await deps.execute(WORKFLOW_EXECUTIONS_QUERY, {
		where: { workflowId: pickedWorkflow.workflowId, orgId },
		order: [['createdAt', 'desc']],
		limit: 20,
	});
	const execRows = (
		(execResult.data as { workflowExecutions?: (ExecutionRow | null)[] } | undefined)?.workflowExecutions ?? []
	).filter((r): r is ExecutionRow => !!r);

	const execItems: (vscode.QuickPickItem & { executionId: string })[] = buildExecutionQuickPickItems(execRows).map(
		(item, i) => ({
			...item,
			executionId: execRows[i]?.id ?? '',
		}),
	);

	if (execItems.length === 0) {
		void vscode.window.showWarningMessage(
			`No recent executions found for workflow "${pickedWorkflow.workflowName}".`,
		);
		return undefined;
	}

	const pickedExec = await vscode.window.showQuickPick(execItems, {
		placeHolder: 'Select an execution to use as render context',
		title: 'Jinja Preview: Pick Execution',
	});
	if (!pickedExec) return undefined;

	return {
		workflowId: pickedWorkflow.workflowId,
		workflowName: pickedWorkflow.workflowName,
		orgId,
		executionId: pickedExec.executionId,
	};
}
