/**
 * Execution-log fetching, run-poll, child-execution formatting, and the
 * buddy_render_jinja runner.
 *
 * Extracted from workflowTools.ts (D1 split).
 */

import { type GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import { asBooleanArg, asStringArg, type ToolRequest } from '../ui/chat/tools/toolProtocol';
import { fetchWorkflow } from './graphMutations';
import { firstErrorMessage, isPlainObject, type ExecResult, type RawTask, type RawWorkflow } from './types';

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const EXECUTION_CONTEXTS_QUERY = `query RewstBuddyExecutionContexts($id: ID!) {
	workflowExecutionContexts(workflowExecutionId: $id)
}`;

// renderJinja evaluates a template; `vars` becomes the CTX namespace. No side effects.
const RENDER_JINJA_MUTATION = `mutation RewstBuddyRenderJinja($orgId: ID!, $template: String!, $vars: JSON) {
	renderJinja(orgId: $orgId, template: $template, vars: $vars)
}`;

export const TEST_WORKFLOW_MUTATION = `mutation RewstBuddyTestWorkflow($id: ID!, $orgId: ID!, $input: JSON) {
	testWorkflow(id: $id, orgId: $orgId, input: $input) {
		executionId
	}
}`;

export const WORKFLOW_EXECUTIONS_QUERY = `query RewstBuddyExecutions($where: WorkflowExecutionWhereInput, $order: [[String!]!], $limit: Int) {
	workflowExecutions(where: $where, order: $order, limit: $limit) {
		id status createdAt numSuccessfulTasks orgId originatingExecutionId parentExecutionId
	}
}`;

const TASK_LOGS_QUERY = `query RewstBuddyTaskLogs($where: TaskLogWhereInput) {
	taskLogs(where: $where, order: [["createdAt", "ASC"]]) {
		id originalWorkflowTaskName status message input result createdAt taskExecutionId
	}
}`;

// A sub-workflow call spawns a child execution whose parentTaskExecutionId
// points back at the spawning task's taskExecutionId.
const CHILD_EXECUTIONS_QUERY = `query RewstBuddyChildExecutions($where: WorkflowExecutionWhereInput) {
	workflowExecution(where: $where) {
		id status orgId
		workflow { id name orgId }
		childExecutions { id status createdAt parentTaskExecutionId workflow { id name } }
	}
}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskLogRow {
	id?: string | null;
	originalWorkflowTaskName?: string | null;
	status?: string | null;
	message?: string | null;
	input?: unknown;
	result?: unknown;
	createdAt?: string | null;
	taskExecutionId?: string | null;
}

export interface ChildExecutionRow {
	id?: string | null;
	status?: string | null;
	createdAt?: string | null;
	parentTaskExecutionId?: string | null;
	workflow?: { id?: string | null; name?: string | null } | null;
}

export interface ExecutionRow {
	id?: string | null;
	status?: string | null;
	createdAt?: string | null;
	numSuccessfulTasks?: number | null;
	orgId?: string | null;
	originatingExecutionId?: string | null;
	parentExecutionId?: string | null;
}

export interface ExecutionDetail {
	id?: string | null;
	status?: string | null;
	orgId?: string | null;
	workflow?: { id?: string | null; name?: string | null; orgId?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TASK_VALUE_CHARS = 600;
const MAX_INLINE_SUB_EXECUTIONS = 5;

export function isFailedStatus(status: string | null | undefined): boolean {
	return /fail|error/i.test(status ?? '');
}

function briefValue(value: unknown): string {
	if (value === undefined || value === null) return '(none)';
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (!text) return '(none)';
	return text.length > TASK_VALUE_CHARS ? text.slice(0, TASK_VALUE_CHARS) + '…(truncated)' : text;
}

export async function fetchTaskLogs(deps: GraphqlToolDeps, executionId: string): Promise<TaskLogRow[]> {
	const result = await deps.execute(TASK_LOGS_QUERY, { where: { workflowExecutionId: executionId } });
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`Failed to read task logs: ${error}`);
	return ((result.data as { taskLogs?: (TaskLogRow | null)[] } | undefined)?.taskLogs ?? []).filter(
		(r): r is TaskLogRow => !!r,
	);
}

export async function fetchChildExecutions(
	deps: GraphqlToolDeps,
	executionId: string,
): Promise<{ execution?: ExecutionDetail; children: ChildExecutionRow[]; error?: string }> {
	try {
		const result = await deps.execute(CHILD_EXECUTIONS_QUERY, { where: { id: executionId } });
		const error = firstErrorMessage(result as ExecResult);
		if (error) return { children: [], error };
		const parent = (
			result.data as
				| { workflowExecution?: (ExecutionDetail & { childExecutions?: (ChildExecutionRow | null)[] }) | null }
				| undefined
		)?.workflowExecution;
		return {
			execution: parent
				? { id: parent.id, status: parent.status, orgId: parent.orgId, workflow: parent.workflow }
				: undefined,
			children: (parent?.childExecutions ?? []).filter((row): row is ChildExecutionRow => !!row),
		};
	} catch (error) {
		return { children: [], error: error instanceof Error ? error.message : String(error) };
	}
}

export function describeChildExecution(child: ChildExecutionRow): string {
	return `${child.workflow?.name ?? '(unknown workflow)'} (${child.id ?? '?'}, ${child.status ?? '?'})`;
}

export async function assertExecutionBelongsToOrg(
	deps: GraphqlToolDeps,
	executionId: string,
	orgId: string,
): Promise<void> {
	const result = await deps.execute(WORKFLOW_EXECUTIONS_QUERY, {
		where: { id: executionId, orgId },
		limit: 1,
	});
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`Failed to verify execution ${executionId} in org ${orgId}: ${error}`);
	const row = (
		(result.data as { workflowExecutions?: (ExecutionRow | null)[] } | undefined)?.workflowExecutions ?? []
	).find((entry): entry is ExecutionRow => !!entry);
	if (!row) {
		throw new Error(`Execution ${executionId} was not found in org ${orgId}.`);
	}
}

function fetchTaskLogsForVisibleExecution(
	deps: GraphqlToolDeps,
	executionId: string,
	orgId: string | undefined,
): Promise<TaskLogRow[]> {
	if (orgId)
		return assertExecutionBelongsToOrg(deps, executionId, orgId).then(() => fetchTaskLogs(deps, executionId));
	return fetchTaskLogs(deps, executionId);
}

export function formatTaskLogs(
	rows: TaskLogRow[],
	opts: { failedOnly?: boolean; includeResult?: boolean },
	childrenByTask?: Map<string, ChildExecutionRow[]>,
): string {
	const visible = opts.failedOnly ? rows.filter(r => isFailedStatus(r.status)) : rows;
	if (visible.length === 0) {
		return opts.failedOnly ? 'No failed tasks in this execution.' : 'This execution has no task logs yet.';
	}
	return visible
		.map(row => {
			const name = row.originalWorkflowTaskName ?? '(unnamed task)';
			const failed = isFailedStatus(row.status);
			const parts = [`- ${name}: ${row.status ?? '?'}`];
			for (const child of (row.taskExecutionId && childrenByTask?.get(row.taskExecutionId)) || []) {
				parts.push(`    sub-execution: ${describeChildExecution(child)}`);
			}
			if (failed) {
				if (row.message) parts.push(`    message: ${briefValue(row.message)}`);
				parts.push(`    input: ${briefValue(row.input)}`);
				parts.push(`    result: ${briefValue(row.result)}`);
			} else if (opts.includeResult) {
				parts.push(`    result: ${briefValue(row.result)}`);
			}
			return parts.join('\n');
		})
		.join('\n');
}

// ---------------------------------------------------------------------------
// buddy_render_jinja runner
// ---------------------------------------------------------------------------

function containsControlCharacter(value: unknown): boolean {
	if (typeof value === 'string') {
		for (let i = 0; i < value.length; i++) {
			const code = value.charCodeAt(i);
			if (code === 9 || code === 10 || code === 13) continue;
			if (code <= 31 || code === 127) return true;
		}
		return false;
	}
	if (Array.isArray(value)) return value.some(containsControlCharacter);
	if (isPlainObject(value)) return Object.values(value).some(containsControlCharacter);
	return false;
}

export async function runRenderJinja(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const orgId = asStringArg(request.args, 'orgId');
	const template = asStringArg(request.args, 'template');
	const keysMode = request.args.keys === true;
	if (!orgId) throw new Error('buddy_render_jinja requires "orgId".');
	if (!keysMode && !template) {
		throw new Error('buddy_render_jinja requires "template" (or pass keys:true to list the context keys).');
	}

	let vars = request.args.vars && typeof request.args.vars === 'object' ? (request.args.vars as object) : undefined;
	let contextNote = '';
	const executionId = asStringArg(request.args, 'executionId');
	if (executionId) {
		await assertExecutionBelongsToOrg(deps, executionId, orgId);
		const snapshots = await fetchExecutionContextSnapshots(deps, executionId);
		if (typeof request.args.contextIndex === 'number') {
			// Coerce to integer before indexing: a non-integer like 2.5 would survive
			// Math.max/min and produce snapshots[2.5] === undefined, causing a
			// misleading 'requires executionId or vars' error even with a valid executionId.
			const index = Math.max(0, Math.min(snapshots.length - 1, Math.trunc(request.args.contextIndex)));
			vars = snapshots[index] as object;
			contextNote = ` (snapshot ${index} of ${snapshots.length}, unmerged)`;
		} else {
			vars = Object.assign({}, ...snapshots.filter(isPlainObject)) as object;
			contextNote = ` (merged from ${snapshots.length} snapshot(s))`;
		}
	}
	if (!vars) {
		throw new Error(
			'buddy_render_jinja requires "executionId" (a run to use as context) or "vars" (an inline context).',
		);
	}

	if (keysMode) {
		const keys = Object.keys(vars as Record<string, unknown>).sort();
		return `Context top-level keys (${keys.length}): ${keys.join(', ') || '(none)'}${contextNote}\n\nDrill in with {{ CTX.<key> }}. System vars: execution id = CTX.execution_id, org id = CTX.organization.id, this workflow's id = CTX.trigger_instance.trigger.workflow_id.`;
	}

	const result = await deps.execute(RENDER_JINJA_MUTATION, { orgId, template, vars });
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`renderJinja failed: ${error}`);
	const rendered = (result.data as { renderJinja?: { result?: unknown; error?: unknown } } | undefined)?.renderJinja;
	if (rendered && typeof rendered === 'object' && 'error' in rendered && rendered.error) {
		return `Jinja error: ${typeof rendered.error === 'string' ? rendered.error : JSON.stringify(rendered.error)}`;
	}
	const value = rendered && typeof rendered === 'object' && 'result' in rendered ? rendered.result : rendered;
	const warning = containsControlCharacter(value)
		? "\n\nWARNING — rendered result contains a control character. If this came from regex_replace backreference escaping, use '\\\\\\\\1' instead of '\\\\1'."
		: '';
	return `Rendered: ${JSON.stringify(value)} (type ${value === null ? 'null' : typeof value})${warning}`;
}

// ---------------------------------------------------------------------------
// Shared context-snapshot fetcher
// ---------------------------------------------------------------------------

export async function fetchExecutionContextSnapshots(deps: GraphqlToolDeps, executionId: string): Promise<unknown[]> {
	const result = await deps.execute(EXECUTION_CONTEXTS_QUERY, { id: executionId });
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`Failed to read execution context: ${error}`);
	const raw = (result.data as { workflowExecutionContexts?: unknown } | undefined)?.workflowExecutionContexts;
	const snapshots = Array.isArray(raw) ? raw : raw ? [raw] : [];
	if (snapshots.length === 0) throw new Error(`Execution ${executionId} has no context to render against.`);
	return snapshots;
}

// ---------------------------------------------------------------------------
// Multi-session sweep helper
// ---------------------------------------------------------------------------

export interface TaskLogSweepResult {
	rows: TaskLogRow[];
	sourceDeps: GraphqlToolDeps;
	sourceNote: string;
	hadVisibleSession: boolean;
	firstError?: unknown;
}

export async function sweepTaskLogs(
	deps: GraphqlToolDeps,
	executionId: string,
	orgId: string | undefined,
): Promise<TaskLogSweepResult> {
	let rows: TaskLogRow[] = [];
	let sourceDeps = deps;
	let sourceNote = '';
	let firstError: unknown;
	let hadVisibleSession = false;
	const readFrom = async (candidate: GraphqlToolDeps): Promise<TaskLogRow[] | undefined> => {
		try {
			const found = await fetchTaskLogsForVisibleExecution(candidate, executionId, orgId);
			hadVisibleSession = true;
			sourceDeps = candidate;
			return found;
		} catch (error) {
			firstError ??= error;
			return undefined;
		}
	};
	rows = (await readFrom(deps)) ?? [];
	const alternates = deps.alternates ?? [];
	if (rows.length === 0) {
		for (const alternate of alternates) {
			const alternateRows = await readFrom(alternate);
			if (!alternateRows) continue;
			rows = alternateRows;
			if (rows.length > 0) {
				sourceNote = ' (found via another active session)';
				break;
			}
		}
	}
	return { rows, sourceDeps, sourceNote, hadVisibleSession, firstError };
}

// ---------------------------------------------------------------------------
// buddy_execution_logs runner
// ---------------------------------------------------------------------------

export async function runExecutionLogs(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const executionId = asStringArg(request.args, 'executionId');
	if (!executionId) throw new Error('buddy_execution_logs requires "executionId".');
	const orgId = asStringArg(request.args, 'orgId');
	const failedOnly = asBooleanArg(request.args, 'failedOnly') ?? false;
	const includeResult = asBooleanArg(request.args, 'includeResult') ?? false;
	const includeSubExecutions = asBooleanArg(request.args, 'includeSubExecutions') ?? false;
	const sweep = await sweepTaskLogs(deps, executionId, orgId);
	const { rows, sourceDeps, sourceNote, hadVisibleSession, firstError } = sweep;
	const alternates = deps.alternates ?? [];
	if (rows.length === 0 && !hadVisibleSession && firstError) {
		throw firstError instanceof Error ? firstError : new Error(String(firstError));
	}
	const failed = rows.filter(r => isFailedStatus(r.status)).length;
	const header = `Execution ${executionId}: ${rows.length} task(s), ${failed} failed.${sourceNote}`;
	const emptyHint =
		rows.length === 0 && alternates.length > 0
			? `\nNone of the ${alternates.length + 1} active session(s) can see task logs for this execution — check the execution id, or sign in to the Rewst account whose org owns it.`
			: '';

	let children: ChildExecutionRow[] = [];
	let childLookupError: string | undefined;
	if (rows.length > 0) {
		({ children, error: childLookupError } = await fetchChildExecutions(sourceDeps, executionId));
	}
	const childrenByTask = new Map<string, ChildExecutionRow[]>();
	const unshownChildren: ChildExecutionRow[] = [];
	const shownRows = failedOnly ? rows.filter(row => isFailedStatus(row.status)) : rows;
	const shownTaskExecutionIds = new Set(shownRows.map(row => row.taskExecutionId).filter((id): id is string => !!id));
	for (const child of children) {
		const parentTask = child.parentTaskExecutionId;
		if (parentTask && shownTaskExecutionIds.has(parentTask)) {
			childrenByTask.set(parentTask, [...(childrenByTask.get(parentTask) ?? []), child]);
		} else {
			unshownChildren.push(child);
		}
	}

	const footer: string[] = [];
	if (childLookupError) {
		footer.push(`Sub-workflow executions could not be checked: ${childLookupError}`);
	}
	if (children.length > 0) {
		footer.push(
			`Spawned ${children.length} sub-workflow execution(s). Drill into one with buddy_execution_logs {"executionId": "<sub-execution id>"}${includeSubExecutions ? '' : ', or pass includeSubExecutions:true to inline their task logs'}.`,
		);
	}
	if (unshownChildren.length > 0) {
		footer.push(
			`Sub-execution(s) not shown with a task above: ${unshownChildren.map(describeChildExecution).join(', ')}`,
		);
	}
	if (includeSubExecutions) {
		const inlineSections = await Promise.all(
			children.slice(0, MAX_INLINE_SUB_EXECUTIONS).map(async child => {
				if (!child.id) return undefined;
				try {
					const childRows = await fetchTaskLogs(sourceDeps, child.id);
					return `Sub-execution ${describeChildExecution(child)}:\n${formatTaskLogs(childRows, { failedOnly, includeResult })}`;
				} catch (error) {
					return `Sub-execution ${describeChildExecution(child)}: task logs could not be read (${error instanceof Error ? error.message : String(error)})`;
				}
			}),
		);
		footer.push(...inlineSections.filter((section): section is string => !!section));
		if (children.length > MAX_INLINE_SUB_EXECUTIONS) {
			footer.push(
				`(${children.length - MAX_INLINE_SUB_EXECUTIONS} more sub-execution(s) not inlined — drill into them individually.)`,
			);
		}
	}

	const footerText = footer.length > 0 ? `\n${footer.join('\n')}` : '';
	return `${header}${emptyHint}\n${formatTaskLogs(rows, { failedOnly, includeResult }, childrenByTask)}${footerText}`;
}

// ---------------------------------------------------------------------------
// Run-and-wait
// ---------------------------------------------------------------------------

const RUNNING_EXECUTION_STATUSES = new Set(['running', 'queued', 'pending', 'new', 'scheduled', 'waiting']);
const RUN_POLL_INTERVAL_MS = 2_000;
const RUN_MAX_WAIT_MS = 45_000;

function isTerminalExecutionStatus(status: string | null | undefined): boolean {
	return !!status && !RUNNING_EXECUTION_STATUSES.has(status.toLowerCase());
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollExecutionStatus(
	deps: GraphqlToolDeps,
	executionId: string,
): Promise<{ status?: string; timedOut: boolean }> {
	const deadline = Date.now() + RUN_MAX_WAIT_MS;
	for (;;) {
		const result = await deps.execute(WORKFLOW_EXECUTIONS_QUERY, {
			where: { id: executionId },
			order: [['createdAt', 'desc']],
			limit: 1,
		});
		const error = firstErrorMessage(result as ExecResult);
		if (error) throw new Error(`Failed to poll execution ${executionId}: ${error}`);
		const status =
			(result.data as { workflowExecutions?: (ExecutionRow | null)[] } | undefined)?.workflowExecutions?.[0]
				?.status ?? undefined;
		if (isTerminalExecutionStatus(status)) return { status, timedOut: false };
		if (Date.now() >= deadline) return { status, timedOut: true };
		await delay(RUN_POLL_INTERVAL_MS);
	}
}

export async function runWorkflowRun(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const workflowId = asStringArg(request.args, 'workflowId');
	const orgId = asStringArg(request.args, 'orgId');
	if (!workflowId || !orgId) throw new Error('buddy_workflow_run requires "workflowId" and "orgId".');
	const input = request.args.input && typeof request.args.input === 'object' ? request.args.input : undefined;
	const result = await deps.execute(TEST_WORKFLOW_MUTATION, { id: workflowId, orgId, input });
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`testWorkflow failed: ${error}`);
	const executionId = (result.data as { testWorkflow?: { executionId?: string } } | undefined)?.testWorkflow
		?.executionId;
	if (!executionId) throw new Error('testWorkflow returned no execution id.');
	const name = asStringArg(request.args, 'workflowName');

	if (request.args.wait === false) {
		return `Started a run of "${name}". executionId: ${executionId}\n\nWatch it with buddy_execution_logs {"executionId": "${executionId}"}, or inspect context with buddy_render_jinja {"executionId": "${executionId}", "template": "{{ CTX.<field> }}"}. `;
	}

	const { status, timedOut } = await pollExecutionStatus(deps, executionId);
	if (timedOut) {
		return `Started a run of "${name}". executionId: ${executionId}\nStill ${status ?? 'running'} after ${Math.round(RUN_MAX_WAIT_MS / 1000)}s — check back with buddy_execution_logs {"executionId": "${executionId}"}.`;
	}
	const head = `Run of "${name}" finished: ${(status ?? 'unknown').toUpperCase()}. executionId: ${executionId}`;
	if (isFailedStatus(status)) {
		const rows = await fetchTaskLogs(deps, executionId);
		return `${head}\n\nFailing task(s):\n${formatTaskLogs(rows, { failedOnly: true })}\n\nFull logs: buddy_execution_logs {"executionId": "${executionId}"}. For a one-call root-cause digest (transition path + sub-executions + context), use buddy_workflow_diagnose {"executionId": "${executionId}"}.`;
	}
	return `${head}\n\nInspect what it produced with buddy_execution_logs {"executionId": "${executionId}", "includeResult": true} or buddy_render_jinja {"executionId": "${executionId}", "template": "{{ CTX.<field> }}"}. `;
}

// ---------------------------------------------------------------------------
// buddy_workflow_executions runner
// ---------------------------------------------------------------------------

export async function runWorkflowExecutions(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const workflowId = asStringArg(request.args, 'workflowId');
	const orgId = asStringArg(request.args, 'orgId');
	if (!workflowId || !orgId) throw new Error('buddy_workflow_executions requires "workflowId" and "orgId".');
	const status = asStringArg(request.args, 'status');
	const limit = typeof request.args.limit === 'number' ? Math.max(1, Math.min(50, request.args.limit)) : 10;
	const rootOnly = asBooleanArg(request.args, 'rootOnly') ?? true;
	const where = { workflowId, ...(rootOnly ? { orgId } : {}), ...(status ? { status } : {}) };
	const result = await deps.execute(WORKFLOW_EXECUTIONS_QUERY, { where, order: [['createdAt', 'desc']], limit });
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`Failed to list executions: ${error}`);
	const rows = (
		(result.data as { workflowExecutions?: (ExecutionRow | null)[] } | undefined)?.workflowExecutions ?? []
	).filter((e): e is ExecutionRow => !!e);
	if (rows.length === 0 && rootOnly) {
		return `No ${status ?? 'recent'} root-level executions for workflow ${workflowId}. If this workflow is called as a sub-workflow, retry with rootOnly:false.`;
	}
	if (rows.length === 0) return `No ${status ?? 'recent'} executions for workflow ${workflowId}.`;
	const fmt = (e: ExecutionRow): string => {
		const ts = Number(e.createdAt);
		const when = Number.isFinite(ts) ? new Date(ts).toISOString() : (e.createdAt ?? '?');
		const links = [
			e.orgId ? `org ${e.orgId}` : undefined,
			e.parentExecutionId ? `parent ${e.parentExecutionId}` : undefined,
			e.originatingExecutionId ? `root ${e.originatingExecutionId}` : undefined,
		]
			.filter(Boolean)
			.join('  ');
		return `- ${e.id}  ${e.status}  ${when}  (${e.numSuccessfulTasks ?? '?'} task(s) ok)${links ? `  ${links}` : ''}`;
	};
	return `${rows.length} ${status ?? 'recent'} execution(s), newest first:\n${rows.map(fmt).join('\n')}\n\nInspect one with buddy_render_jinja {"executionId": "<id>", "template": "{{ CTX.<field> }}"}. `;
}

// ---------------------------------------------------------------------------
// buddy_workflow_diagnose runner
// ---------------------------------------------------------------------------

async function findLatestFailedExecutionId(
	deps: GraphqlToolDeps,
	workflowId: string,
	orgId: string,
): Promise<string | undefined> {
	const result = await deps.execute(WORKFLOW_EXECUTIONS_QUERY, {
		where: { workflowId, orgId, status: 'FAILED' },
		order: [['createdAt', 'desc']],
		limit: 1,
	});
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`Failed to find a failed execution for workflow ${workflowId}: ${error}`);
	const row = (
		(result.data as { workflowExecutions?: (ExecutionRow | null)[] } | undefined)?.workflowExecutions ?? []
	).find((entry): entry is ExecutionRow => !!entry);
	return row?.id ?? undefined;
}

function describeTransitionsInto(workflow: RawWorkflow, task: RawTask): string[] {
	const lines: string[] = [];
	for (const candidate of workflow.tasks) {
		for (const transition of candidate.next ?? []) {
			if ((transition.do ?? []).includes(task.id)) {
				lines.push(`${candidate.name} --[${transition.when ?? '{{ SUCCEEDED }}'}]--> ${task.name}`);
			}
		}
	}
	return lines;
}

function describeTransitionsOut(workflow: RawWorkflow, task: RawTask): string[] {
	const nameById = new Map(workflow.tasks.map(t => [t.id, t.name]));
	return (task.next ?? []).flatMap(transition => {
		const targets = (transition.do ?? []).map(id => nameById.get(id) ?? id);
		if (targets.length === 0) return [];
		return [`${task.name} --[${transition.when ?? '{{ SUCCEEDED }}'}]--> ${targets.join(', ')}`];
	});
}

export async function runWorkflowDiagnose(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const explicitExecutionId = asStringArg(request.args, 'executionId');
	const workflowIdArg = asStringArg(request.args, 'workflowId');
	const orgIdArg = asStringArg(request.args, 'orgId');
	if (!explicitExecutionId && !workflowIdArg) {
		throw new Error(
			'buddy_workflow_diagnose requires "executionId", or "workflowId" (with "orgId") to find its latest failed execution.',
		);
	}

	let executionId = explicitExecutionId;
	if (!executionId) {
		if (!orgIdArg) throw new Error('buddy_workflow_diagnose requires "orgId" together with "workflowId".');
		const found = await findLatestFailedExecutionId(deps, workflowIdArg as string, orgIdArg);
		if (!found) return `No FAILED executions found for workflow ${workflowIdArg} in org ${orgIdArg}.`;
		executionId = found;
	}

	const sweep = await sweepTaskLogs(deps, executionId, orgIdArg);
	if (sweep.rows.length === 0 && !sweep.hadVisibleSession && sweep.firstError) {
		throw sweep.firstError instanceof Error ? sweep.firstError : new Error(String(sweep.firstError));
	}
	const { rows, sourceDeps, sourceNote } = sweep;
	const alternates = deps.alternates ?? [];
	const failedCount = rows.filter(r => isFailedStatus(r.status)).length;
	const sections: string[] = [
		`Diagnosis for execution ${executionId}: ${rows.length} task(s), ${failedCount} failed.${sourceNote}`,
	];
	if (rows.length === 0 && alternates.length > 0) {
		sections.push(
			`None of the ${alternates.length + 1} active session(s) can see task logs for this execution — check the execution id, or sign in to the Rewst account whose org owns it.`,
		);
	}

	const failingTask = rows.find(r => isFailedStatus(r.status));
	const {
		execution: detail,
		children,
		error: childLookupError,
	} = await fetchChildExecutions(sourceDeps, executionId);

	if (!failingTask) {
		const statusNote = detail?.status ? ` (execution status: ${detail.status})` : '';
		sections.push(
			`No failing task found in this execution${statusNote}. If the run is still in progress, retry once it finishes.`,
		);
		return sections.join('\n\n');
	}

	const childrenOfFailingTask = failingTask.taskExecutionId
		? children.filter(child => child.parentTaskExecutionId === failingTask.taskExecutionId)
		: [];
	const otherChildren = children.filter(child => !childrenOfFailingTask.includes(child));
	const childrenByTask = new Map<string, ChildExecutionRow[]>();
	if (failingTask.taskExecutionId && childrenOfFailingTask.length > 0) {
		childrenByTask.set(failingTask.taskExecutionId, childrenOfFailingTask);
	}
	sections.push(
		`Failing task (likely root cause):\n${formatTaskLogs([failingTask], { includeResult: true }, childrenByTask)}`,
	);

	if (childLookupError) sections.push(`Sub-workflow executions could not be checked: ${childLookupError}`);
	const failedChild = childrenOfFailingTask.find(child => isFailedStatus(child.status));
	if (failedChild) {
		sections.push(
			`likely deeper cause: sub-execution ${describeChildExecution(failedChild)} — drill in with buddy_workflow_diagnose {"executionId": "${failedChild.id}"}.`,
		);
	}
	if (otherChildren.length > 0) {
		sections.push(
			`Other sub-workflow execution(s) not tied to the failing task: ${otherChildren.map(describeChildExecution).join(', ')}`,
		);
	}

	const workflowId = workflowIdArg ?? detail?.workflow?.id ?? undefined;
	const orgId = orgIdArg ?? detail?.orgId ?? detail?.workflow?.orgId ?? undefined;
	if (workflowId && orgId) {
		try {
			const workflow = await fetchWorkflow(sourceDeps, workflowId, orgId);
			const task = workflow.tasks.find(t => t.name === failingTask.originalWorkflowTaskName);
			if (task) {
				const incoming = describeTransitionsInto(workflow, task);
				const outgoing = describeTransitionsOut(workflow, task);
				sections.push(
					[
						`Transition path (action ${task.action?.ref ?? task.actionId ?? '?'}):`,
						incoming.length > 0
							? incoming.map(l => `  in:  ${l}`).join('\n')
							: '  in:  (none — start task)',
						outgoing.length > 0
							? outgoing.map(l => `  out: ${l}`).join('\n')
							: '  out: (none — terminal task)',
					].join('\n'),
				);
			} else {
				sections.push(
					`Workflow definition unavailable: task "${failingTask.originalWorkflowTaskName}" not found in workflow ${workflowId}.`,
				);
			}
		} catch (error) {
			sections.push(`Workflow definition unavailable: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	try {
		const snapshots = await fetchExecutionContextSnapshots(sourceDeps, executionId);
		const merged = Object.assign({}, ...snapshots.filter(isPlainObject)) as Record<string, unknown>;
		const keys = Object.keys(merged).sort();
		sections.push(
			`Execution context (merged from ${snapshots.length} snapshot(s)), top-level keys: ${keys.join(', ') || '(none)'}. Inspect one with buddy_render_jinja {"executionId": "${executionId}", "template": "{{ CTX.<key> }}"}.`,
		);
	} catch (error) {
		sections.push(`Execution context unavailable: ${error instanceof Error ? error.message : String(error)}`);
	}

	sections.push(`Full task-by-task list: buddy_execution_logs {"executionId": "${executionId}"}.`);
	return sections.join('\n\n');
}

// Re-export fetchWorkflow for use by runWorkflowGet in the adapter
export { fetchWorkflow };
