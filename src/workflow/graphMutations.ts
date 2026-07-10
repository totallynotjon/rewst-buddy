/**
 * Workflow edit engine: GraphQL queries/mutations, the 11-op applyOperations
 * pipeline, workflowToInput round-trip mapping, field coercers, allowlist sets,
 * setAdvancedTaskFields, divergence verification, and the shared write pipeline.
 *
 * Extracted from workflowTools.ts (D1 split). Pure functions are network-free;
 * network helpers (fetchWorkflow, applyWorkflowMutation) take GraphqlToolDeps.
 */

import { randomUUID } from 'crypto';
import { type GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import { asStringArg } from '../ui/chat/tools/toolProtocol';
import { autoLayout, layoutNewTasks, setPosition } from './layout';
import { ADD_TASK_FIELDS, PACK_OVERRIDE_FIELDS, UPDATE_TASK_SET_FIELDS } from './operationGrammar';
import {
	type ExecResult,
	MUTATION_SCOPE_KEYS,
	type PackOverride,
	type PublishEntry,
	type RawTask,
	type RawTransition,
	type RawWorkflow,
	asObject,
	firstErrorMessage,
	isPlainObject,
	isSuccessCondition,
	normalizePublish,
	orderTransitionsByCondition,
	str,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETRY_REJECTION =
	'Tasks do not take a "retry" config: the Rewst engine fails to initialize a task saved with one and the run dies with no task logs. Implement retries as a loop: wrap the action in its own sub-workflow, route its failure transition to a delay task, and loop back with a bounded attempt counter.';

// ---------------------------------------------------------------------------
// GraphQL queries and mutations
// ---------------------------------------------------------------------------

export const WORKFLOW_GET_QUERY = `query RewstBuddyWorkflowGet($where: WorkflowWhereInput) {
	workflow(where: $where) {
		id name description type schemaVersion version orgId updatedAt
		organization { id name }
		action { parameters }
		input output inputSchema outputSchema varsSchema metadata timeout
		tasks {
			id name actionId description input metadata
			transitionMode publishResultAs join timeout humanSecondsSaved
			isMocked mockInput runAsOrgId securitySchema
			packOverrides { configSelectionMode configFallbackMode packId packConfigId searchInput }
			action { id ref name }
			retry { count delay when }
			with { items concurrency }
			next { id from to when label do publish top left orientation targetHandles }
		}
	}
}`;

const WORKFLOW_UPDATE_MUTATION = `mutation RewstBuddyWorkflowUpdate($workflow: WorkflowInput!, $openedAt: String, $comment: String) {
	updateWorkflow(workflow: $workflow, openedAt: $openedAt, createPatch: true, comment: $comment) {
		id name updatedAt
	}
}`;

export const ACTIONS_SEARCH_QUERY = `query RewstBuddyActionSearch($orgId: ID!, $search: ActionSearch, $limit: Int) {
	actionsForOrg(orgId: $orgId, search: $search, limit: $limit) {
		id ref name category deprecated
	}
}`;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TaskVerifyFields {
	input?: boolean;
	with?: boolean;
	runAsOrgId?: boolean;
	packOverrides?: boolean;
	isMocked?: boolean;
	mockInput?: boolean;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export async function fetchWorkflow(deps: GraphqlToolDeps, workflowId: string, orgId: string): Promise<RawWorkflow> {
	const result = await deps.execute(WORKFLOW_GET_QUERY, { where: { id: workflowId, orgId } });
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`Failed to read workflow: ${error}`);
	const workflow = (result.data as { workflow?: RawWorkflow } | undefined)?.workflow;
	if (!workflow) throw new Error(`Workflow ${workflowId} not found in org ${orgId}.`);
	return workflow;
}

// ---------------------------------------------------------------------------
// read -> WorkflowInput conversion (pure)
// ---------------------------------------------------------------------------

function normalizeOutputEntries(input: object): PublishEntry[] {
	if (Array.isArray(input)) {
		return input.map(entry => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
				throw new Error('set_output array entries must be objects shaped as {name, value}.');
			}
			const record = entry as Record<string, unknown>;
			if (typeof record.name !== 'string' || record.name.trim() === '' || !('value' in record)) {
				throw new Error('set_output array entries must include non-empty "name" and present "value".');
			}
			return { key: record.name, value: record.value };
		});
	}
	return Object.entries(input as Record<string, unknown>).map(([key, value]) => {
		if (key.trim() === '') throw new Error('set_output object output names must be non-empty.');
		return { key, value };
	});
}

function transitionToInput(t: RawTransition): Record<string, unknown> {
	const input: Record<string, unknown> = {
		do: Array.isArray(t.do) ? t.do : [],
		publish: normalizePublish(t.publish),
	};
	if (t.id) input.id = t.id;
	if (t.from != null) input.from = t.from;
	if (t.to != null) input.to = t.to;
	if (t.when != null) input.when = t.when;
	if (t.label != null) input.label = t.label;
	if (t.top != null) input.top = t.top;
	if (t.left != null) input.left = t.left;
	if (t.orientation != null) input.orientation = t.orientation;
	if (t.targetHandles != null) input.targetHandles = t.targetHandles;
	return input;
}

/** Strips a read-back pack override down to the fields PackOverrideInput accepts. */
export function packOverrideToInput(o: PackOverride): Record<string, unknown> {
	const out: Record<string, unknown> = { packId: o.packId };
	if (o.packConfigId != null) out.packConfigId = o.packConfigId;
	if (o.configSelectionMode != null) out.configSelectionMode = o.configSelectionMode;
	if (o.configFallbackMode != null) out.configFallbackMode = o.configFallbackMode;
	if (o.searchInput != null) out.searchInput = o.searchInput;
	return out;
}

function taskToInput(t: RawTask): Record<string, unknown> {
	const input: Record<string, unknown> = {
		id: t.id,
		name: t.name,
		input: t.input ?? {},
		metadata: t.metadata ?? {},
		next: (t.next ?? []).map(transitionToInput),
	};
	if (t.packOverrides != null) input.packOverrides = t.packOverrides.map(packOverrideToInput);
	if (t.actionId) input.actionId = t.actionId;
	if (t.description != null) input.description = t.description;
	if (t.transitionMode != null) input.transitionMode = t.transitionMode;
	if (t.publishResultAs != null) input.publishResultAs = t.publishResultAs;
	if (t.join != null) input.join = t.join;
	if (t.timeout != null) input.timeout = t.timeout;
	if (t.humanSecondsSaved != null) input.humanSecondsSaved = t.humanSecondsSaved;
	if (t.isMocked != null) input.isMocked = t.isMocked;
	if (t.mockInput != null) input.mockInput = t.mockInput;
	if (t.runAsOrgId != null) input.runAsOrgId = t.runAsOrgId;
	if (t.securitySchema != null) input.securitySchema = t.securitySchema;
	if (t.retry != null) input.retry = t.retry;
	if (t.with != null) input.with = t.with;
	return input;
}

export function workflowToInput(
	w: RawWorkflow,
	tasks: RawTask[],
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const input: Record<string, unknown> = {
		id: w.id,
		orgId: w.orgId,
		name: w.name,
		tasks: tasks.map(taskToInput),
	};
	if (w.description != null) input.description = w.description;
	if (w.type != null) input.type = w.type;
	if (w.schemaVersion != null) input.schemaVersion = w.schemaVersion;
	if (w.version != null) input.version = w.version;
	if (w.input != null) input.input = w.input;
	if (w.action?.parameters != null) input.parameters = w.action.parameters;
	if (w.inputSchema != null) input.inputSchema = w.inputSchema;
	if (w.outputSchema != null) input.outputSchema = w.outputSchema;
	if (w.varsSchema != null) input.varsSchema = w.varsSchema;
	if (w.metadata != null) input.metadata = w.metadata;
	if (w.timeout != null) input.timeout = w.timeout;
	return Object.assign(input, overrides);
}

// ---------------------------------------------------------------------------
// Operations (high-level edit primitives)
// ---------------------------------------------------------------------------

export interface WorkflowOperation {
	op: string;
	[key: string]: unknown;
}

/** New task ids must be de-dashed hex, or `do` references won't match (Disparity 6). */
function newTaskId(): string {
	return randomUUID().replace(/-/g, '');
}

// ---------------------------------------------------------------------------
// Field coercers
// ---------------------------------------------------------------------------

export function isActionIdShape(value: string): boolean {
	return /^[0-9a-fA-F]{32}$/.test(value) || /^[0-9a-fA-F-]{36}$/.test(value);
}

/**
 * Several task fields are JSON objects (`input`, `with`). MCP clients sometimes
 * deliver them as a JSON-encoded string. Parse back to object, treat null/undefined
 * as empty, and reject anything else rather than silently corrupting the field.
 */
function coerceObjectField(value: unknown, label: string): Record<string, unknown> {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') return {};
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new Error(`${label} must be a JSON object; received a string that is not valid JSON.`);
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error(`${label} must be a JSON object, not a JSON array or scalar.`);
		}
		return parsed as Record<string, unknown>;
	}
	if (value == null) return {};
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object, not an array or scalar.`);
	}
	return value as Record<string, unknown>;
}

function coerceTaskInput(value: unknown): Record<string, unknown> {
	return coerceObjectField(value, 'task "input"');
}

function coerceNullableString(value: unknown, label: string): string | null {
	if (value === null) return null;
	if (typeof value === 'string') return value;
	throw new Error(`${label} must be a string or null.`);
}

function coerceBoolean(value: unknown, label: string): boolean {
	if (typeof value === 'boolean') return value;
	throw new Error(`${label} must be a boolean.`);
}

const PACK_CONFIG_SELECTION_MODES = new Set(['USE_DEFAULT', 'USE_NAME_SEARCH', 'USE_ORG_MAPPING', 'USE_SELECTED_ID']);
const PACK_CONFIG_FALLBACK_MODES = new Set(['FAIL_ACTION', 'FAIL_WORKFLOW', 'USE_DEFAULT']);

function coercePackOverrides(value: unknown): PackOverride[] {
	let raw = value;
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw);
		} catch {
			throw new Error('packOverrides must be a JSON array; received a string that is not valid JSON.');
		}
	}
	if (!Array.isArray(raw)) throw new Error('packOverrides must be an array of objects.');
	return raw.map((entry, index) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error(`packOverrides[${index}] must be an object.`);
		}
		const record = entry as Record<string, unknown>;
		rejectUnsupportedFields(record, PACK_OVERRIDE_FIELDS, `packOverrides[${index}]`);
		const packId = str(record.packId);
		if (!packId) throw new Error(`packOverrides[${index}].packId must be a non-empty string.`);
		const out: PackOverride = { packId };
		for (const key of ['packConfigId', 'configSelectionMode', 'configFallbackMode', 'searchInput'] as const) {
			if (!(key in record)) continue;
			const value = record[key];
			if (value !== null && typeof value !== 'string') {
				throw new Error(`packOverrides[${index}].${key} must be a string or null.`);
			}
			if (key === 'configSelectionMode' && typeof value === 'string' && !PACK_CONFIG_SELECTION_MODES.has(value)) {
				throw new Error(
					`packOverrides[${index}].configSelectionMode "${value}" is not supported; use one of ${[
						...PACK_CONFIG_SELECTION_MODES,
					].join(', ')}.`,
				);
			}
			if (key === 'configFallbackMode' && typeof value === 'string' && !PACK_CONFIG_FALLBACK_MODES.has(value)) {
				throw new Error(
					`packOverrides[${index}].configFallbackMode "${value}" is not supported; use one of ${[
						...PACK_CONFIG_FALLBACK_MODES,
					].join(', ')}.`,
				);
			}
			out[key] = value;
		}
		return out;
	});
}

function assertStringLeaves(value: unknown, path: string): void {
	if (typeof value === 'string') return;
	if (Array.isArray(value)) {
		for (const [i, entry] of value.entries()) {
			assertStringLeaves(entry, `${path}[${i}]`);
		}
		return;
	}
	if (isPlainObject(value)) {
		for (const [key, entry] of Object.entries(value)) {
			assertStringLeaves(entry, `${path}.${key}`);
		}
		return;
	}
	throw new Error(
		`${path} leaf values must be strings; use Jinja strings like "{{ 42 }}" or "{{ true }}" for non-string mock data.`,
	);
}

function coerceMockInput(value: unknown): RawTask['mockInput'] {
	if (value === null) return null;
	const record = coerceObjectField(value, 'task "mockInput"');
	if (!('mock_result' in record)) {
		throw new Error('mockInput.mock_result must be present; wrap mocked outputs as {"mock_result": {...}}.');
	}
	if (!isPlainObject(record.mock_result)) {
		throw new Error('mockInput.mock_result must be a JSON object whose leaf values are strings.');
	}
	assertStringLeaves(record.mock_result, 'mockInput.mock_result');
	return record;
}

export function rejectUnsupportedFields(record: Record<string, unknown>, allowed: Set<string>, label: string): void {
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) throw new Error(`Unsupported ${label} field "${key}".`);
	}
}

export const ADVANCED_TASK_FIELD_TABLE = {
	runAsOrgId: {
		verifyField: 'runAsOrgId',
		coerce: (value: unknown) => coerceNullableString(value, 'runAsOrgId'),
	},
	packOverrides: {
		verifyField: 'packOverrides',
		coerce: coercePackOverrides,
	},
	isMocked: {
		verifyField: 'isMocked',
		coerce: (value: unknown) => coerceBoolean(value, 'isMocked'),
	},
	mockInput: {
		verifyField: 'mockInput',
		coerce: (value: unknown) => (value == null ? null : coerceMockInput(value)),
	},
} satisfies Record<
	Exclude<keyof TaskVerifyFields, 'input' | 'with'>,
	{
		verifyField: keyof TaskVerifyFields;
		coerce(value: unknown): unknown;
	}
>;

export function setAdvancedTaskFields(
	task: RawTask,
	source: Record<string, unknown>,
	mark?: (field: keyof TaskVerifyFields) => void,
): void {
	const writableTask = task as RawTask & Record<string, unknown>;
	for (const [field, entry] of Object.entries(ADVANCED_TASK_FIELD_TABLE)) {
		if (!(field in source)) continue;
		writableTask[field] = entry.coerce(source[field]);
		mark?.(entry.verifyField);
	}
}

/**
 * Numeric task settings are typed Int on the wire, so a float fails at the
 * mutation boundary. Coerce a numeric string to a number and accept only integers.
 */
function coerceTaskNumber(value: unknown, label: string): number {
	if (typeof value === 'number' && Number.isInteger(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		if (Number.isInteger(parsed)) return parsed;
	}
	throw new Error(`${label} must be an integer.`);
}

/** Resolves a task reference (id or name) to the task, or throws a clear error. */
function resolveTask(tasks: RawTask[], ref: string): RawTask {
	const byId = tasks.find(t => t.id === ref);
	if (byId) return byId;
	const byName = tasks.filter(t => t.name === ref);
	if (byName.length === 1) return byName[0];
	if (byName.length > 1) throw new Error(`Task name "${ref}" is ambiguous (${byName.length} tasks); use the id.`);
	throw new Error(`No task named or with id "${ref}".`);
}

function droppedParallelControlsNote(source: Record<string, unknown>): string {
	const dropped = ['transitionMode', 'join'].filter(key => key in source);
	return dropped.length ? ` (ignored ${dropped.join('/')}: this tool does not set task parallelism)` : '';
}

// ---------------------------------------------------------------------------
// Post-pass helpers (called after all operations are applied)
// ---------------------------------------------------------------------------

function ensureTaskDefaults(tasks: RawTask[]): void {
	for (const task of tasks) {
		if (!task.transitionMode) task.transitionMode = 'FOLLOW_FIRST';
		if (task.join == null) task.join = 1;
	}
}

function ensureTerminalTransitions(tasks: RawTask[]): void {
	for (const task of tasks) {
		if ((task.next ?? []).length === 0) {
			task.next = [{ when: '{{ SUCCEEDED }}', label: '', do: [], publish: [] }];
		}
	}
}

function removeRedundantTerminalSuccessTransitions(tasks: RawTask[]): void {
	for (const task of tasks) {
		const transitions = task.next;
		if (!transitions || transitions.length < 2) continue;
		const hasTargetedSuccess = transitions.some(t => isSuccessCondition(t.when) && (t.do ?? []).length > 0);
		if (!hasTargetedSuccess) continue;
		task.next = transitions.filter(
			t => !(isSuccessCondition(t.when) && (t.do ?? []).length === 0 && (t.publish ?? []).length === 0),
		);
	}
}

/** Locates a transition on a task by transitionId, then by target ref. */
function findTransition(tasks: RawTask[], from: RawTask, operation: WorkflowOperation): RawTransition {
	const transitions = from.next ?? [];
	const transitionId = str(operation.transitionId);
	if (transitionId) {
		const match = transitions.find(t => t.id === transitionId);
		if (!match) throw new Error(`No transition with id "${transitionId}" on ${from.name}.`);
		return match;
	}
	const toRef = str(operation.to);
	if (toRef) {
		const toId = resolveTask(tasks, toRef).id;
		const matches = transitions.filter(t => (t.do ?? []).includes(toId));
		if (matches.length === 0) throw new Error(`No transition from ${from.name} to "${toRef}".`);
		if (matches.length > 1)
			throw new Error(`Multiple transitions from ${from.name} to "${toRef}"; use transitionId.`);
		return matches[0];
	}
	if (transitions.length === 1) return transitions[0];
	throw new Error(`${from.name} has ${transitions.length} transitions; specify "to" or "transitionId".`);
}

/** Collects action refs (non-id) referenced by add/update ops, for resolution. */
export function actionRefsIn(operations: WorkflowOperation[]): string[] {
	const refs = new Set<string>();
	for (const operation of operations) {
		const candidates = [str(operation.action), str(asObject(operation.set).action)];
		for (const candidate of candidates) {
			if (candidate && !isActionIdShape(candidate)) refs.add(candidate);
		}
	}
	return [...refs];
}

export async function resolveActionIds(
	deps: GraphqlToolDeps,
	orgId: string,
	refs: string[],
): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	for (const ref of refs) {
		const result = await deps.execute(ACTIONS_SEARCH_QUERY, { orgId, search: { ref: { _eq: ref } }, limit: 1 });
		const rows = (result.data as { actionsForOrg?: { id?: string }[] } | undefined)?.actionsForOrg ?? [];
		const id = rows[0]?.id;
		if (!id) throw new Error(`Action ref "${ref}" not found in org ${orgId}.`);
		map.set(ref, id);
	}
	return map;
}

// ---------------------------------------------------------------------------
// applyOperations — the 11-op edit engine (pure, no network)
// ---------------------------------------------------------------------------

/**
 * Applies operations to a copy of the task list. Action refs in add/update ops
 * are resolved to ids beforehand via actionIdByRef. Returns the new task list,
 * a human-readable summary of what changed, workflow-level overrides, and the
 * ids of tasks whose input/with an operation supplied (for post-save verification).
 */
export function applyOperations(
	tasks: RawTask[],
	operations: WorkflowOperation[],
	actionIdByRef: Map<string, string>,
): {
	tasks: RawTask[];
	applied: string[];
	workflow: Record<string, unknown>;
	verifyFields: Map<string, TaskVerifyFields>;
} {
	const next: RawTask[] = tasks.map(t => ({
		...t,
		next: (t.next ?? []).map(n => ({ ...n, do: [...(n.do ?? [])] })),
	}));
	const applied: string[] = [];
	const workflow: Record<string, unknown> = {};
	const verifyFields = new Map<string, TaskVerifyFields>();
	const markVerify = (id: string, field: keyof TaskVerifyFields) => {
		const fields = verifyFields.get(id) ?? {};
		fields[field] = true;
		verifyFields.set(id, fields);
	};

	const resolveActionId = (action: string): string => {
		if (isActionIdShape(action)) return action;
		const id = actionIdByRef.get(action);
		if (!id) throw new Error(`Could not resolve action "${action}" to an id.`);
		return id;
	};

	let structural = false;
	let explicitPositioning = false;

	for (const operation of operations) {
		const op = operation.op;
		switch (op) {
			case 'add_task': {
				if ('retry' in operation || 'retries' in operation) throw new Error(`add_task: ${RETRY_REJECTION}`);
				rejectUnsupportedFields(operation, ADD_TASK_FIELDS, 'add_task');
				const name = str(operation.name);
				const action = str(operation.action);
				const subWorkflowId = str(operation.subWorkflowId);
				if (!name) throw new Error('add_task requires a "name".');
				if (!action && !subWorkflowId) {
					throw new Error(
						'add_task requires an "action" (ref or id) or a "subWorkflowId" (to call another workflow).',
					);
				}
				const id = str(operation.id) ? str(operation.id)!.replace(/-/g, '') : newTaskId();
				if (next.some(t => t.id === id)) throw new Error(`add_task id "${id}" already exists.`);
				const task: RawTask = {
					id,
					name,
					actionId: subWorkflowId ?? resolveActionId(action!),
					input: coerceTaskInput(operation.input),
					metadata: {},
					transitionMode: 'FOLLOW_FIRST',
					join: 1,
					next: [],
				};
				if (str(operation.publishResultAs) != null) task.publishResultAs = str(operation.publishResultAs);
				if (operation.timeout != null) task.timeout = coerceTaskNumber(operation.timeout, 'timeout');
				if ('description' in operation) task.description = operation.description as string;
				if (operation.with != null)
					task.with = coerceObjectField(operation.with, 'task "with"') as RawTask['with'];
				setAdvancedTaskFields(task, operation, field => markVerify(id, field));
				if (typeof operation.x === 'number' && typeof operation.y === 'number') {
					setPosition(task, operation.x, operation.y);
					explicitPositioning = true;
				}
				structural = true;
				next.push(task);
				if ('input' in operation) markVerify(id, 'input');
				if ('with' in operation) markVerify(id, 'with');
				applied.push(
					`add_task ${name} (${id}) ${subWorkflowId ? `subWorkflow=${subWorkflowId}` : `action=${action}`}${droppedParallelControlsNote(operation)}`,
				);
				break;
			}
			case 'update_task': {
				const ref = str(operation.id) ?? str(operation.name);
				if (!ref) throw new Error('update_task requires "id" or "name".');
				const task = resolveTask(next, ref);
				const set = asObject(operation.set);
				if ('x' in set || 'y' in set) {
					throw new Error('update_task.set does not move tasks — use reposition {task, x, y} instead.');
				}
				if ('retry' in set || 'retries' in set) throw new Error(`update_task.set: ${RETRY_REJECTION}`);
				rejectUnsupportedFields(set, UPDATE_TASK_SET_FIELDS, 'update_task.set');
				if (str(set.name)) task.name = str(set.name)!;
				if ('input' in set) task.input = coerceTaskInput(set.input);
				if (str(set.subWorkflowId)) task.actionId = str(set.subWorkflowId)!;
				else if (str(set.action)) task.actionId = resolveActionId(str(set.action)!);
				if ('publishResultAs' in set) task.publishResultAs = set.publishResultAs as string;
				if ('timeout' in set) task.timeout = coerceTaskNumber(set.timeout, 'timeout');
				if ('description' in set) task.description = set.description as string;
				if ('with' in set) task.with = coerceObjectField(set.with, 'task "with"') as RawTask['with'];
				setAdvancedTaskFields(task, set, field => markVerify(task.id, field));
				if ('input' in set) markVerify(task.id, 'input');
				if ('with' in set) markVerify(task.id, 'with');
				applied.push(`update_task ${task.name} (${task.id})${droppedParallelControlsNote(set)}`);
				break;
			}
			case 'delete_task': {
				const ref = str(operation.id) ?? str(operation.name);
				if (!ref) throw new Error('delete_task requires "id" or "name".');
				const task = resolveTask(next, ref);
				const index = next.indexOf(task);
				next.splice(index, 1);
				for (const other of next) {
					other.next = (other.next ?? []).filter(transition => {
						const targets = transition.do ?? [];
						const hadTargets = targets.length > 0;
						transition.do = targets.filter(target => target !== task.id);
						return !(hadTargets && transition.do.length === 0);
					});
				}
				verifyFields.delete(task.id);
				structural = true;
				applied.push(`delete_task ${task.name} (${task.id})`);
				break;
			}
			case 'connect': {
				const fromRef = str(operation.from);
				const toRef = str(operation.to);
				if (!fromRef || !toRef) throw new Error('connect requires "from" and "to".');
				const from = resolveTask(next, fromRef);
				const to = resolveTask(next, toRef);
				const transition: RawTransition = {
					when: str(operation.when) ?? '{{ SUCCEEDED }}',
					label: typeof operation.label === 'string' ? operation.label : '',
					do: [to.id],
					publish: normalizePublish(operation.publish),
				};
				if (!isSuccessCondition(transition.when) && (transition.label ?? '').trim() === '') {
					throw new Error(
						'connect: a custom transition (when other than {{ SUCCEEDED }}) requires a non-empty "label" naming the branch.',
					);
				}
				const existing = from.next ?? [];
				const terminalIndex = existing.findIndex(t => isSuccessCondition(t.when) && (t.do ?? []).length === 0);
				from.next =
					terminalIndex >= 0 && isSuccessCondition(transition.when)
						? [...existing.slice(0, terminalIndex), transition, ...existing.slice(terminalIndex)]
						: [...existing, transition];
				structural = true;
				applied.push(`connect ${from.name} -> ${to.name} when ${transition.when}`);
				break;
			}
			case 'disconnect': {
				const fromRef = str(operation.from);
				if (!fromRef) throw new Error('disconnect requires "from".');
				const from = resolveTask(next, fromRef);
				const transitionId = str(operation.transitionId);
				const toRef = str(operation.to);
				const toId = toRef ? resolveTask(next, toRef).id : undefined;
				const before = (from.next ?? []).length;
				from.next = (from.next ?? []).filter(transition => {
					if (transitionId) return transition.id !== transitionId;
					if (toId) {
						transition.do = (transition.do ?? []).filter(target => target !== toId);
						return (transition.do ?? []).length > 0;
					}
					return true;
				});
				structural = true;
				applied.push(`disconnect ${from.name} (${before - (from.next?.length ?? 0)} edge(s) removed)`);
				break;
			}
			case 'set_transition': {
				const fromRef = str(operation.from);
				if (!fromRef) throw new Error('set_transition requires "from".');
				const from = resolveTask(next, fromRef);
				const transition = findTransition(next, from, operation);
				const set = asObject(operation.set);
				if ('when' in set) transition.when = set.when as string;
				if ('label' in set) transition.label = set.label as string;
				if ('publish' in set) transition.publish = normalizePublish(set.publish);
				if ('to' in set) {
					const targets = Array.isArray(set.to) ? (set.to as string[]) : [set.to as string];
					transition.do = targets.map(target => resolveTask(next, target).id);
				}
				if (!isSuccessCondition(transition.when) && !(transition.label ?? '').trim()) {
					throw new Error(
						'set_transition: the resulting transition has a custom condition, so it requires a non-empty "label" — set it in the same operation.',
					);
				}
				structural = true;
				applied.push(`set_transition on ${from.name}`);
				break;
			}
			case 'reposition': {
				const ref = str(operation.task) ?? str(operation.id) ?? str(operation.name);
				if (!ref) throw new Error('reposition requires "task" (a task id or name).');
				if (typeof operation.x !== 'number' || typeof operation.y !== 'number') {
					throw new Error('reposition requires numeric "x" and "y" canvas coordinates.');
				}
				const task = resolveTask(next, ref);
				setPosition(task, operation.x, operation.y);
				explicitPositioning = true;
				applied.push(`reposition ${task.name} -> (${operation.x}, ${operation.y})`);
				break;
			}
			case 'autolayout': {
				autoLayout(next);
				explicitPositioning = true;
				applied.push(`autolayout (${next.length} node(s) re-arranged)`);
				break;
			}
			case 'set_inputs': {
				const defs = Array.isArray(operation.inputs)
					? (operation.inputs as Record<string, unknown>[])
					: undefined;
				if (!defs)
					throw new Error(
						'set_inputs requires an "inputs" array of { name, type?, title?, default?, description?, required?, multiline? }.',
					);
				const names: string[] = [];
				const required: string[] = [];
				const properties: Record<string, unknown> = {};
				const parameters: Record<string, unknown> = {};
				for (const def of defs) {
					const name = str(def.name);
					if (!name) throw new Error('each set_inputs entry needs a "name".');
					names.push(name);
					const type = str(def.type) ?? 'string';
					const title = str(def.title) ?? name;
					const description = str(def.description) ?? '';
					const isRequired = def.required === true;
					if (isRequired) required.push(name);
					const hasDefault = 'default' in def;
					const formattedDefault =
						typeof def.default === 'boolean' || typeof def.default === 'number'
							? `{{ ${def.default} }}`
							: def.default;
					const schemaProp: Record<string, unknown> = { type, title };
					if (hasDefault) schemaProp.default = formattedDefault;
					if (description) schemaProp.description = description;
					properties[name] = schemaProp;
					parameters[name] = {
						type,
						label: title,
						default: hasDefault ? formattedDefault : '',
						required: isRequired,
						multiline: def.multiline === true,
						description,
					};
				}
				workflow.input = names;
				workflow.parameters = parameters;
				workflow.inputSchema = { type: 'object', required, properties };
				applied.push(`set_inputs (${names.length}: ${names.join(', ') || 'none'})`);
				break;
			}
			case 'set_output': {
				const raw = operation.outputs;
				if (raw == null || typeof raw !== 'object') {
					throw new Error(
						'set_output requires "outputs": a {name: "<jinja>"} object or [{name, value}] array (an empty array clears the outputs).',
					);
				}
				const entries = normalizeOutputEntries(raw);
				workflow.output = entries.map(entry => ({
					[entry.key]:
						typeof entry.value === 'boolean' || typeof entry.value === 'number'
							? `{{ ${entry.value} }}`
							: entry.value,
				}));
				applied.push(`set_output (${entries.length}: ${entries.map(entry => entry.key).join(', ') || 'none'})`);
				break;
			}
			default:
				throw new Error(`Unknown operation "${op}".`);
		}
	}
	ensureTerminalTransitions(next);
	removeRedundantTerminalSuccessTransitions(next);
	orderTransitionsByCondition(next);
	ensureTaskDefaults(next);
	if (structural && !explicitPositioning) {
		autoLayout(next);
		applied.push('autolayout (automatic after structural edits)');
	} else {
		layoutNewTasks(next);
	}
	return { tasks: next, applied, workflow, verifyFields };
}

// ---------------------------------------------------------------------------
// Divergence verification
// ---------------------------------------------------------------------------

const TASK_VALUE_CHARS = 600;

function briefValue(value: unknown): string {
	if (value === undefined || value === null) return '(none)';
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (!text) return '(none)';
	return text.length > TASK_VALUE_CHARS ? text.slice(0, TASK_VALUE_CHARS) + '…(truncated)' : text;
}

function storedValueMatches(sent: unknown, stored: unknown): boolean {
	if (sent === stored) return true;
	if (isPlainObject(sent) && isPlainObject(stored)) {
		return Object.entries(sent).every(([key, value]) => key in stored && storedValueMatches(value, stored[key]));
	}
	if (Array.isArray(sent) && Array.isArray(stored)) {
		return sent.length === stored.length && sent.every((value, i) => storedValueMatches(value, stored[i]));
	}
	if (sent != null && stored != null && typeof sent !== 'object' && typeof stored !== 'object') {
		return String(sent) === String(stored);
	}
	return false;
}

/**
 * Lines describing where a stored value diverges from what was sent, each
 * prefixed with the dotted path.
 */
export function sentValueDivergences(sent: unknown, stored: unknown, path: string): string[] {
	if (isPlainObject(sent) && isPlainObject(stored)) {
		if (Object.keys(sent).length === 0 && Object.keys(stored).length > 0) {
			return Object.entries(stored).map(
				([key, value]) => `${path}.${key}: sent (none), stored ${briefValue(value)}`,
			);
		}
		const lines: string[] = [];
		for (const [key, value] of Object.entries(sent)) {
			const childPath = `${path}.${key}`;
			if (!(key in stored)) {
				lines.push(`${childPath}: sent ${briefValue(value)}, not stored`);
			} else {
				lines.push(...sentValueDivergences(value, stored[key], childPath));
			}
		}
		return lines;
	}
	if (Array.isArray(sent) && Array.isArray(stored) && sent.length === stored.length) {
		return sent.flatMap((value, index) => sentValueDivergences(value, stored[index], `${path}.${index}`));
	}
	return storedValueMatches(sent, stored) ? [] : [`${path}: sent ${briefValue(sent)}, stored ${briefValue(stored)}`];
}

async function verifySavedTaskValues(
	deps: GraphqlToolDeps,
	workflowId: string,
	orgId: string,
	toVerify: { task: RawTask; fields: TaskVerifyFields }[],
): Promise<string> {
	try {
		const saved = await fetchWorkflow(deps, workflowId, orgId);
		const storedById = new Map(saved.tasks.map(t => [t.id, t]));
		const problems: string[] = [];
		for (const { task: sent, fields } of toVerify) {
			const stored = storedById.get(sent.id);
			if (!stored) {
				problems.push(`- task "${sent.name}": not present in the saved workflow`);
				continue;
			}
			const lines = [
				...(fields.input ? sentValueDivergences(sent.input ?? {}, stored.input ?? {}, 'input') : []),
				...(fields.with ? sentValueDivergences(sent.with ?? {}, stored.with ?? {}, 'with') : []),
				...(fields.runAsOrgId
					? sentValueDivergences(sent.runAsOrgId ?? null, stored.runAsOrgId ?? null, 'runAsOrgId')
					: []),
				...(fields.packOverrides
					? sentValueDivergences(sent.packOverrides ?? [], stored.packOverrides ?? [], 'packOverrides')
					: []),
				...(fields.isMocked
					? sentValueDivergences(sent.isMocked ?? null, stored.isMocked ?? null, 'isMocked')
					: []),
				...(fields.mockInput
					? sentValueDivergences(sent.mockInput ?? null, stored.mockInput ?? null, 'mockInput')
					: []),
			];
			problems.push(...lines.map(line => `- task "${sent.name}": ${line}`));
		}
		if (problems.length === 0) return '';
		return (
			`\n\nWARNING — the server did not store some task values as sent. Rewst may filter task input against the action's inputSchema or normalize advanced task configuration such as org overrides, integration overrides, mocking, while the save still reports success.\n` +
			`${problems.join('\n')}\n` +
			`Check the action's accepted parameters, advanced configuration or field mapping with buddy_action_search describe mode, then re-apply with matching keys, types, and supported configuration values.`
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `\n\nNote: the edit saved, but the tool could not verify the stored task inputs (${message}); re-read with buddy_workflow_get to confirm.`;
	}
}

// ---------------------------------------------------------------------------
// Shared write pipeline
// ---------------------------------------------------------------------------

type UpdateWorkflowResult = { updateWorkflow?: { name?: string; updatedAt?: string } } | undefined;

/**
 * Rewst's updateWorkflow resolver can silently default a newly created task's
 * packOverrides configSelectionMode/configFallbackMode on the SAME write that
 * creates the task, while honoring them on a follow-up update of that
 * already-existing task (server-side quirk — #174). Re-sends just the healable
 * tasks' packOverrides in one corrective updateWorkflow call, replaying the
 * "call update_task a second time" workaround programmatically. Returns
 * `ok: false` (no self-heal attempted/succeeded) on any fetch or mutation
 * error, leaving the original verification warning as the caller's fallback.
 */
async function healCreatedTaskPackOverrides(
	deps: GraphqlToolDeps,
	workflowId: string,
	orgId: string,
	healable: RawTask[],
	comment: string,
): Promise<{ ok: boolean; updatedAt?: string }> {
	try {
		const fresh = await fetchWorkflow(deps, workflowId, orgId);
		const byId = new Map(fresh.tasks.map(t => [t.id, t]));
		for (const task of healable) {
			const current = byId.get(task.id);
			if (current) current.packOverrides = task.packOverrides;
		}
		const result = await deps.execute(WORKFLOW_UPDATE_MUTATION, {
			workflow: workflowToInput(fresh, fresh.tasks, {}),
			openedAt: fresh.updatedAt,
			comment: `${comment} (auto-correct packOverrides mode on newly created task(s))`,
		});
		if (firstErrorMessage(result as ExecResult)) return { ok: false };
		const updated = (result.data as UpdateWorkflowResult)?.updateWorkflow;
		return { ok: true, updatedAt: updated?.updatedAt };
	} catch {
		return { ok: false };
	}
}

/**
 * The shared workflow write pipeline: resolve action refs, read the current
 * workflow, apply operations to the whole graph, and save with the correct
 * openedAt token — retrying once on a version conflict.
 */
export async function applyWorkflowMutation(
	deps: GraphqlToolDeps,
	workflowId: string,
	orgId: string,
	operations: WorkflowOperation[],
	comment: string,
): Promise<string> {
	const actionIdByRef = await resolveActionIds(deps, orgId, actionRefsIn(operations));
	const apply = (source: RawWorkflow) => applyOperations(source.tasks, operations, actionIdByRef);

	const workflow = await fetchWorkflow(deps, workflowId, orgId);
	// Tracks task ids that existed before this edit, so a task created by one of
	// this batch's own add_task operations can be told apart from a pre-existing
	// one for the packOverrides self-heal below. Recomputed from `fresh` on a
	// version-conflict retry so a task another edit concurrently created between
	// our read and write is never misclassified as "created by this batch".
	let originalTaskIds = new Set(workflow.tasks.map(t => t.id));
	let { tasks, applied, workflow: overrides, verifyFields } = apply(workflow);
	if (!(await deps.confirmMutation(`update workflow "${workflow.name}" (${applied.length} operation(s))`))) {
		throw new Error('Workflow change was not confirmed.');
	}
	let result = await deps.execute(WORKFLOW_UPDATE_MUTATION, {
		workflow: workflowToInput(workflow, tasks, overrides),
		openedAt: workflow.updatedAt,
		comment,
	});

	let error = firstErrorMessage(result as ExecResult);
	if (error && /newer version/i.test(error)) {
		const fresh = await fetchWorkflow(deps, workflowId, orgId);
		originalTaskIds = new Set(fresh.tasks.map(t => t.id));
		({ tasks, applied, workflow: overrides, verifyFields } = apply(fresh));
		result = await deps.execute(WORKFLOW_UPDATE_MUTATION, {
			workflow: workflowToInput(fresh, tasks, overrides),
			openedAt: fresh.updatedAt,
			comment,
		});
		error = firstErrorMessage(result as ExecResult);
	}
	if (error) throw new Error(`updateWorkflow failed: ${error}`);

	let updated = (result.data as UpdateWorkflowResult)?.updateWorkflow;
	const toVerify = tasks.flatMap(task => {
		const fields = verifyFields.get(task.id);
		return fields ? [{ task, fields }] : [];
	});
	let verification = toVerify.length > 0 ? await verifySavedTaskValues(deps, workflowId, orgId, toVerify) : '';

	// Scoped per task (not just "does the warning mention packOverrides anywhere"):
	// only a task this batch created, whose OWN divergence line is present, is a
	// heal candidate — an unrelated task's divergence must never trigger a
	// pointless corrective write for a created task that already matched.
	const healable = toVerify
		.filter(({ task, fields }) => fields.packOverrides && !originalTaskIds.has(task.id))
		.map(({ task }) => task)
		.filter(task => verification.includes(`task "${task.name}": packOverrides`));
	if (healable.length > 0) {
		const heal = await healCreatedTaskPackOverrides(deps, workflowId, orgId, healable, comment);
		if (heal.ok) {
			if (heal.updatedAt) updated = { ...updated, updatedAt: heal.updatedAt };
			verification = await verifySavedTaskValues(deps, workflowId, orgId, toVerify);
			if (!/packOverrides/.test(verification)) {
				verification += `\n\nNote: auto-corrected packOverrides on ${healable.length} newly created task(s) — the server ignored the requested selection/fallback mode on creation but accepted it on this follow-up update.`;
			}
		}
	}

	return `Applied ${applied.length} operation(s) to "${workflow.name}":\n${applied.map(line => `- ${line}`).join('\n')}\n\nSaved. New version token: ${updated?.updatedAt ?? '(unknown)'}.${verification}`;
}

// ---------------------------------------------------------------------------
// requireScopeFields (used by tool runners)
// ---------------------------------------------------------------------------

export function requireScopeFields(
	toolName: string,
	args: Record<string, unknown>,
): { workflowId: string; orgId: string } {
	const missing = MUTATION_SCOPE_KEYS.filter(key => !asStringArg(args, key));
	if (missing.length > 0) {
		throw new Error(
			`${toolName} requires non-empty ${MUTATION_SCOPE_KEYS.join(', ')} (get them from buddy_workflow_get). Missing: ${missing.join(', ')}.`,
		);
	}
	return { workflowId: asStringArg(args, 'workflowId')!, orgId: asStringArg(args, 'orgId')! };
}
