/**
 * Pure helpers for the Jinja preview panel's context-pick flow.
 * No VS Code QuickPick UI here — only data assembly and cache-key logic
 * that can be unit-tested without a real webview.
 */

import vscode from 'vscode';
import type { JinjaPreviewContextEntry } from '../models/JinjaPreviewContextStore';
import type { GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import type { ExecutionRow } from '../workflow/executions';
import { fetchExecutionContextSnapshots, WORKFLOW_EXECUTIONS_QUERY } from '../workflow/executions';
import { firstErrorMessage, isPlainObject, type ExecResult } from '../workflow/types';

const WORKFLOWS_QUERY = `query RewstBuddyPreviewWorkflows($orgId: ID!, $limit: Int, $offset: Int) {
	workflows(where: { orgId: $orgId }, limit: $limit, offset: $offset, order: [["name", "asc"]]) {
		id
		name
		orgId
	}
}`;

const WORKFLOW_PICK_LIMIT = 500;
const WORKFLOW_PICK_MAX_PAGES = 100;

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

export interface ExecutionQuickPickItem extends vscode.QuickPickItem {
	executionId: string;
	orgId?: string;
}

/**
 * Convert a list of ExecutionRow objects into VS Code QuickPickItems,
 * sorted newest-first by createdAt.
 */
export function buildExecutionQuickPickItems(rows: ExecutionRow[]): ExecutionQuickPickItem[] {
	const sorted = [...rows].sort((a, b) => {
		const ta = Number(a.createdAt ?? 0);
		const tb = Number(b.createdAt ?? 0);
		return tb - ta;
	});
	return sorted.map(row => ({
		label: `$(history) ${row.status ?? 'unknown'} — ${row.id ?? '?'}`,
		detail: row.createdAt ? new Date(Number(row.createdAt)).toLocaleString() : undefined,
		description: row.id ?? undefined,
		executionId: row.id ?? '',
		orgId: row.orgId ?? undefined,
	}));
}

// ---------------------------------------------------------------------------
// buildWorkflowQuickPickItems
// ---------------------------------------------------------------------------

export interface JinjaPreviewOrgPickItem extends vscode.QuickPickItem {
	orgId: string;
	orgName: string;
}

interface WorkflowRow {
	id?: string | null;
	name?: string | null;
	orgId?: string | null;
}

interface WorkflowQuickPickItem extends vscode.QuickPickItem {
	workflowId: string;
	workflowName: string;
	orgId: string;
}

async function fetchWorkflowRows(deps: GraphqlToolDeps, orgId: string): Promise<WorkflowRow[]> {
	const rows: WorkflowRow[] = [];
	for (let page = 0; page < WORKFLOW_PICK_MAX_PAGES; page++) {
		const offset = page * WORKFLOW_PICK_LIMIT;
		const result = await deps.execute(WORKFLOWS_QUERY, { orgId, limit: WORKFLOW_PICK_LIMIT, offset });
		const error = firstErrorMessage(result as ExecResult);
		if (error) throw new Error(`Failed to list workflows: ${error}`);
		const pageRows = ((result.data as { workflows?: (WorkflowRow | null)[] } | undefined)?.workflows ?? []).filter(
			(row): row is WorkflowRow => !!row?.id,
		);
		rows.push(...pageRows);
		if (pageRows.length < WORKFLOW_PICK_LIMIT) break;
	}
	return rows;
}

function buildWorkflowQuickPickItems(rows: WorkflowRow[], orgId: string): WorkflowQuickPickItem[] {
	return rows.map(row => ({
		label: row.name ?? '(unnamed)',
		description: row.id ?? undefined,
		workflowId: row.id ?? '',
		workflowName: row.name ?? '(unnamed)',
		orgId: row.orgId ?? orgId,
	}));
}

// ---------------------------------------------------------------------------
// pickJinjaExecutionContext
// ---------------------------------------------------------------------------

export interface PickJinjaExecutionContextOptions {
	orgItems: JinjaPreviewOrgPickItem[];
	depsForOrg(orgId: string): Promise<GraphqlToolDeps>;
	initialOrgId?: string;
}

/**
 * Full three-step QuickPick flow: pick an org, pick one workflow in that org,
 * then pick an execution. Returns undefined if the user cancels any step.
 */
export async function pickJinjaExecutionContext({
	orgItems,
	depsForOrg,
	initialOrgId,
}: PickJinjaExecutionContextOptions): Promise<JinjaPreviewContextEntry | undefined> {
	if (orgItems.length === 0) {
		void vscode.window.showWarningMessage('No organizations are available for Jinja preview context.');
		return undefined;
	}

	const pickedOrg = await vscode.window.showQuickPick(orgItems, {
		placeHolder: 'Select an organization to load workflows from',
		title: 'Jinja Preview: Pick Org',
	});
	if (!pickedOrg) return undefined;

	const deps = await depsForOrg(pickedOrg.orgId);
	const workflowItems = buildWorkflowQuickPickItems(await fetchWorkflowRows(deps, pickedOrg.orgId), pickedOrg.orgId);
	if (workflowItems.length === 0) {
		void vscode.window.showWarningMessage(`No workflows found for organization "${pickedOrg.orgName}".`);
		return undefined;
	}

	const pickedWorkflow = await vscode.window.showQuickPick(workflowItems, {
		placeHolder: 'Select a workflow to pick an execution context from',
		title: 'Jinja Preview: Pick Workflow',
		matchOnDescription: true,
	});
	if (!pickedWorkflow) return undefined;

	// Step 2: execution pick. Root-scoped first (workflowId+orgId); a workflow that
	// only ever runs as a sub-workflow has its executions recorded under the
	// caller's orgId, so an empty root query falls back to workflowId alone
	// (mirrors buddy_workflow_executions' rootOnly:false fallback).
	const fetchExecRows = async (where: Record<string, string>): Promise<ExecutionRow[]> => {
		const result = await deps.execute(WORKFLOW_EXECUTIONS_QUERY, {
			where,
			order: [['createdAt', 'desc']],
			limit: 20,
		});
		return (
			(result.data as { workflowExecutions?: (ExecutionRow | null)[] } | undefined)?.workflowExecutions ?? []
		).filter((r): r is ExecutionRow => !!r);
	};

	let execRows = await fetchExecRows({ workflowId: pickedWorkflow.workflowId, orgId: pickedWorkflow.orgId });
	if (execRows.length === 0) {
		execRows = await fetchExecRows({ workflowId: pickedWorkflow.workflowId });
	}

	const execItems = buildExecutionQuickPickItems(execRows);

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
		orgId: pickedExec.orgId || pickedWorkflow.orgId || initialOrgId || pickedOrg.orgId,
		executionId: pickedExec.executionId,
	};
}
