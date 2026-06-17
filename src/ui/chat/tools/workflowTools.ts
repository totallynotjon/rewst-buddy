import { randomUUID } from 'crypto';
import {
	type GraphqlMutationConfirmation,
	type GraphqlToolDeps,
	isMutationScopeApproved,
	type MutationScope,
} from './graphqlTool';
import { asStringArg, type ToolRequest, type ToolSpec } from './toolProtocol';

/**
 * High-level Rewst workflow tools for RoboRewsty. These bundle the multi-step
 * GraphQL choreography that workflow editing otherwise requires into single
 * calls, so the assistant does not have to rediscover the API's quirks every
 * turn (see scripts/WORKFLOW_API_FINDINGS.md for the disparities these encode):
 *
 *   - rewst_workflow_get      read a workflow as a normalized node/edge graph.
 *   - rewst_action_search     find actions, or describe one action's inputs.
 *   - rewst_workflow_edit     apply high-level operations to a workflow safely.
 *
 * The edit tool always resends the FULL workflow (updateWorkflow replaces, it
 * does not merge), carries the correct optimistic-concurrency token (openedAt
 * must equal the updatedAt read at fetch time), and snapshots a patch so every
 * change is reversible. New task ids are de-dashed hex because the server
 * strips dashes from task ids but not from the `do` references that point at
 * them. Reads run directly; the edit is a mutation gated by the same in-chat
 * approval flow as rewst_graphql (see workflowEditConfirmation + lmTools.ts).
 */

const MAX_OUTPUT_CHARS = 8_000;

export const WORKFLOW_EDIT_TOOL_NAME = 'rewst_workflow_edit';

/** Identifying fields a rewst_workflow_edit request must carry (org + workflow). */
const MUTATION_SCOPE_KEYS = ['workflowId', 'workflowName', 'orgId', 'orgName'] as const;

export const WORKFLOW_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'rewst_workflow_get',
		args: '{"workflowId": string, "orgId": string}',
		description:
			'Read a Rewst workflow as a normalized graph: nodes (tasks with their action ref and input) and edges (transitions with their condition, label, target task names, and published context variables). Returns far less noise than raw GraphQL and the node/edge names this tool uses are exactly what rewst_workflow_edit operations expect. Use this before editing a workflow.',
		inputSchema: {
			type: 'object',
			properties: {
				workflowId: { type: 'string', description: 'The workflow id.' },
				orgId: { type: 'string', description: 'The id of the org that owns the workflow.' },
			},
			required: ['workflowId', 'orgId'],
		},
	},
	{
		name: 'rewst_action_search',
		args: '{"orgId": string, "query"?: string, "ref"?: string, "actionId"?: string, "limit"?: number, "includeDeprecated"?: boolean}',
		description:
			"Find Rewst actions for an org, or describe one action's inputs. Search mode (pass query) matches action name and ref, ranks core/common actions first, dedupes, and returns each match's ref, id, and category. Describe mode (pass ref or actionId) returns the action's parameters (the input schema you fill into a task's input) and output schema. Use describe mode before adding a task so you know which inputs the action accepts.",
		inputSchema: {
			type: 'object',
			properties: {
				orgId: { type: 'string', description: 'The org to search actions for.' },
				query: { type: 'string', description: 'Search term matched against action name and ref.' },
				ref: { type: 'string', description: 'Describe this exact action ref (e.g. core.noop).' },
				actionId: { type: 'string', description: 'Describe this exact action id.' },
				limit: { type: 'number', description: 'Max search results (default 15).' },
				includeDeprecated: { type: 'boolean', description: 'Include deprecated actions (default false).' },
			},
			required: ['orgId'],
		},
	},
	{
		name: WORKFLOW_EDIT_TOOL_NAME,
		args: '{"workflowId": string, "workflowName": string, "orgId": string, "orgName": string, "operations": object[], "comment"?: string}',
		description:
			'Edit a Rewst workflow by applying high-level operations. The tool reads the current workflow, applies the operations to the full graph, and saves it back with conflict detection and an undoable patch — you never resend the whole workflow or manage version tokens yourself. Operations (each an object with an "op" field): add_task {name, action (ref or id), input?, publishResultAs?, transitionMode?, join?, with?}; update_task {id|name, set:{...}}; delete_task {id|name} (also removes edges pointing at it); connect {from, to, when?, label?, publish?} (from/to are task names or ids); disconnect {from, to?|transitionId?}; set_transition {from, to?|transitionId?, set:{when?, label?, publish?, to?}}; reposition {from, to?|transitionId?, top?, left?, orientation?}. when defaults to "{{ SUCCEEDED }}". This is a mutation: it MUST include workflowId, workflowName, orgId, orgName (get them from rewst_workflow_get) and requires user approval, remembered per workflow for the session.',
		inputSchema: {
			type: 'object',
			properties: {
				workflowId: { type: 'string', description: 'The workflow id being edited.' },
				workflowName: {
					type: 'string',
					description: 'The workflow name, shown in the approval prompt.',
				},
				orgId: { type: 'string', description: 'The id of the org that owns the workflow.' },
				orgName: { type: 'string', description: 'The org name, shown in the approval prompt.' },
				operations: {
					type: 'array',
					items: { type: 'object' },
					description: 'Ordered list of edit operations to apply.',
				},
				comment: { type: 'string', description: 'Optional patch comment describing the change.' },
			},
			required: ['workflowId', 'workflowName', 'orgId', 'orgName', 'operations'],
		},
	},
];

const WORKFLOW_TOOL_NAMES = new Set(WORKFLOW_TOOL_SPECS.map(spec => spec.name));

export function isWorkflowTool(name: string): boolean {
	return WORKFLOW_TOOL_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Raw read shapes (what the typed GraphQL query returns)
// ---------------------------------------------------------------------------

interface RawTransition {
	id?: string | null;
	from?: string | null;
	to?: string | null;
	when?: string | null;
	label?: string | null;
	do?: string[] | null;
	publish?: unknown[] | null;
	top?: number | null;
	left?: number | null;
	orientation?: string | null;
	targetHandles?: unknown;
}

interface RawTask {
	id: string;
	name: string;
	actionId?: string | null;
	action?: { id?: string | null; ref?: string | null; name?: string | null } | null;
	description?: string | null;
	input?: unknown;
	metadata?: unknown;
	transitionMode?: string | null;
	publishResultAs?: string | null;
	join?: number | null;
	timeout?: number | null;
	humanSecondsSaved?: number | null;
	isMocked?: boolean | null;
	mockInput?: unknown;
	runAsOrgId?: string | null;
	securitySchema?: unknown;
	retry?: { count: string; delay?: string | null; when?: string | null } | null;
	with?: { items?: string | null; concurrency?: string | null } | null;
	next?: RawTransition[] | null;
}

interface RawWorkflow {
	id: string;
	name: string;
	description?: string | null;
	type?: string | null;
	schemaVersion?: string | null;
	version?: string | null;
	orgId: string;
	updatedAt?: string | null;
	input?: string[] | null;
	inputSchema?: unknown;
	outputSchema?: unknown;
	varsSchema?: unknown;
	metadata?: unknown;
	timeout?: number | null;
	tasks: RawTask[];
}

const WORKFLOW_GET_QUERY = `query RewstBuddyWorkflowGet($where: WorkflowWhereInput) {
	workflow(where: $where) {
		id name description type schemaVersion version orgId updatedAt
		input inputSchema outputSchema varsSchema metadata timeout
		tasks {
			id name actionId description input metadata
			transitionMode publishResultAs join timeout humanSecondsSaved
			isMocked mockInput runAsOrgId securitySchema
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

interface ExecResult {
	data?: unknown;
	errors?: unknown;
}

function firstErrorMessage(result: ExecResult): string | undefined {
	const errors = result.errors;
	if (Array.isArray(errors) && errors.length > 0) {
		const message = (errors[0] as { message?: unknown }).message;
		return typeof message === 'string' ? message : JSON.stringify(errors[0]);
	}
	return undefined;
}

async function fetchWorkflow(deps: GraphqlToolDeps, workflowId: string, orgId: string): Promise<RawWorkflow> {
	const result = await deps.execute(WORKFLOW_GET_QUERY, { where: { id: workflowId, orgId } });
	const error = firstErrorMessage(result);
	if (error) throw new Error(`Failed to read workflow: ${error}`);
	const workflow = (result.data as { workflow?: RawWorkflow } | undefined)?.workflow;
	if (!workflow) throw new Error(`Workflow ${workflowId} not found in org ${orgId}.`);
	return workflow;
}

// ---------------------------------------------------------------------------
// publish normalization: the API round-trips [{key, value}]; accept that, a
// {key: value} object, or an array of single-key objects, and normalize.
// ---------------------------------------------------------------------------

interface PublishEntry {
	key: string;
	value: unknown;
}

export function normalizePublish(input: unknown): PublishEntry[] {
	if (input == null) return [];
	const entries: PublishEntry[] = [];
	if (Array.isArray(input)) {
		for (const item of input) {
			if (item && typeof item === 'object') {
				const record = item as Record<string, unknown>;
				if (typeof record.key === 'string') {
					entries.push({ key: record.key, value: record.value });
				} else {
					for (const [key, value] of Object.entries(record)) entries.push({ key, value });
				}
			}
		}
	} else if (typeof input === 'object') {
		for (const [key, value] of Object.entries(input as Record<string, unknown>)) entries.push({ key, value });
	}
	return entries;
}

// ---------------------------------------------------------------------------
// read -> WorkflowInput conversion (pure). Sends back everything so nothing is
// lost; updateWorkflow replaces the whole graph.
// ---------------------------------------------------------------------------

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

function taskToInput(t: RawTask): Record<string, unknown> {
	const input: Record<string, unknown> = {
		id: t.id,
		name: t.name,
		input: t.input ?? {},
		metadata: t.metadata ?? {},
		next: (t.next ?? []).map(transitionToInput),
	};
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

export function workflowToInput(w: RawWorkflow, tasks: RawTask[]): Record<string, unknown> {
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
	if (w.inputSchema != null) input.inputSchema = w.inputSchema;
	if (w.outputSchema != null) input.outputSchema = w.outputSchema;
	if (w.varsSchema != null) input.varsSchema = w.varsSchema;
	if (w.metadata != null) input.metadata = w.metadata;
	if (w.timeout != null) input.timeout = w.timeout;
	return input;
}

// ---------------------------------------------------------------------------
// Operations (high-level edit primitives, applied to the in-memory task list)
// ---------------------------------------------------------------------------

export interface WorkflowOperation {
	op: string;
	[key: string]: unknown;
}

/** New task ids must be de-dashed hex, or `do` references won't match (Disparity 6). */
function newTaskId(): string {
	return randomUUID().replace(/-/g, '');
}

function isActionIdShape(value: string): boolean {
	return /^[0-9a-fA-F]{32}$/.test(value) || /^[0-9a-fA-F-]{36}$/.test(value);
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

/**
 * Applies operations to a copy of the task list. Action refs in add/update ops
 * are resolved to ids beforehand via actionIdByRef. Returns the new task list
 * and a human-readable summary of what changed. Pure — no network.
 */
export function applyOperations(
	tasks: RawTask[],
	operations: WorkflowOperation[],
	actionIdByRef: Map<string, string>,
): { tasks: RawTask[]; applied: string[] } {
	const next: RawTask[] = tasks.map(t => ({
		...t,
		next: (t.next ?? []).map(n => ({ ...n, do: [...(n.do ?? [])] })),
	}));
	const applied: string[] = [];

	const resolveActionId = (action: string): string => {
		if (isActionIdShape(action)) return action;
		const id = actionIdByRef.get(action);
		if (!id) throw new Error(`Could not resolve action "${action}" to an id.`);
		return id;
	};

	for (const operation of operations) {
		const op = operation.op;
		switch (op) {
			case 'add_task': {
				const name = str(operation.name);
				const action = str(operation.action);
				if (!name) throw new Error('add_task requires a "name".');
				if (!action) throw new Error('add_task requires an "action" (ref or id).');
				const id = str(operation.id) ? str(operation.id)!.replace(/-/g, '') : newTaskId();
				if (next.some(t => t.id === id)) throw new Error(`add_task id "${id}" already exists.`);
				const task: RawTask = {
					id,
					name,
					actionId: resolveActionId(action),
					input: asObject(operation.input),
					metadata: {},
					transitionMode: str(operation.transitionMode) ?? 'FOLLOW_ALL',
					next: [],
				};
				if (str(operation.publishResultAs) != null) task.publishResultAs = str(operation.publishResultAs);
				if (typeof operation.join === 'number') task.join = operation.join;
				if (typeof operation.timeout === 'number') task.timeout = operation.timeout;
				if (operation.with && typeof operation.with === 'object') task.with = operation.with as RawTask['with'];
				next.push(task);
				applied.push(`add_task ${name} (${id}) action=${action}`);
				break;
			}
			case 'update_task': {
				const ref = str(operation.id) ?? str(operation.name);
				if (!ref) throw new Error('update_task requires "id" or "name".');
				const task = resolveTask(next, ref);
				const set = asObject(operation.set);
				if (str(set.name)) task.name = str(set.name)!;
				if ('input' in set) task.input = set.input;
				if (str(set.action)) task.actionId = resolveActionId(str(set.action)!);
				if ('publishResultAs' in set) task.publishResultAs = set.publishResultAs as string;
				if ('transitionMode' in set) task.transitionMode = set.transitionMode as string;
				if ('join' in set) task.join = set.join as number;
				if ('timeout' in set) task.timeout = set.timeout as number;
				if ('description' in set) task.description = set.description as string;
				if ('with' in set) task.with = set.with as RawTask['with'];
				applied.push(`update_task ${task.name} (${task.id})`);
				break;
			}
			case 'delete_task': {
				const ref = str(operation.id) ?? str(operation.name);
				if (!ref) throw new Error('delete_task requires "id" or "name".');
				const task = resolveTask(next, ref);
				const index = next.indexOf(task);
				next.splice(index, 1);
				// Strip edges pointing at the removed task; drop transitions left empty.
				for (const other of next) {
					other.next = (other.next ?? []).filter(transition => {
						const targets = transition.do ?? [];
						const hadTargets = targets.length > 0;
						transition.do = targets.filter(target => target !== task.id);
						return !(hadTargets && transition.do.length === 0);
					});
				}
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
				from.next = [...(from.next ?? []), transition];
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
				applied.push(`set_transition on ${from.name}`);
				break;
			}
			case 'reposition': {
				const fromRef = str(operation.from);
				if (!fromRef) throw new Error('reposition requires "from".');
				const from = resolveTask(next, fromRef);
				const transition = findTransition(next, from, operation);
				if (typeof operation.top === 'number') transition.top = operation.top;
				if (typeof operation.left === 'number') transition.left = operation.left;
				if (str(operation.orientation)) transition.orientation = str(operation.orientation);
				applied.push(`reposition transition on ${from.name}`);
				break;
			}
			default:
				throw new Error(`Unknown operation "${op}".`);
		}
	}
	return { tasks: next, applied };
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
function actionRefsIn(operations: WorkflowOperation[]): string[] {
	const refs = new Set<string>();
	for (const operation of operations) {
		const candidates = [str(operation.action), str(asObject(operation.set).action)];
		for (const candidate of candidates) {
			if (candidate && !isActionIdShape(candidate)) refs.add(candidate);
		}
	}
	return [...refs];
}

// ---------------------------------------------------------------------------
// Action search / resolution
// ---------------------------------------------------------------------------

interface ActionRow {
	id?: string | null;
	ref?: string | null;
	name?: string | null;
	category?: string | null;
	description?: string | null;
	deprecated?: boolean | null;
}

const ACTIONS_SEARCH_QUERY = `query RewstBuddyActionSearch($orgId: ID!, $search: ActionSearch, $limit: Int) {
	actionsForOrg(orgId: $orgId, search: $search, limit: $limit) {
		id ref name category deprecated
	}
}`;

const ACTION_DESCRIBE_QUERY = `query RewstBuddyActionDescribe($orgId: ID!, $search: ActionSearch) {
	actionsForOrg(orgId: $orgId, search: $search, limit: 1) {
		id ref name category description deprecated outputSchema parameters(populateOptions: false)
	}
}`;

async function searchActions(
	deps: GraphqlToolDeps,
	orgId: string,
	field: 'name' | 'ref',
	term: string,
	includeDeprecated: boolean,
	limit: number,
): Promise<ActionRow[]> {
	const search: Record<string, unknown> = { [field]: { _ilike: `%${term}%` } };
	if (!includeDeprecated) search.deprecated = { _eq: false };
	const result = await deps.execute(ACTIONS_SEARCH_QUERY, { orgId, search, limit });
	const rows = (result.data as { actionsForOrg?: ActionRow[] } | undefined)?.actionsForOrg ?? [];
	return rows;
}

/** Ranks core/rewst actions and closer matches first; deprecated last. */
function rankActions(rows: ActionRow[], term: string): ActionRow[] {
	const needle = term.toLowerCase();
	const score = (row: ActionRow): number => {
		const ref = (row.ref ?? '').toLowerCase();
		const name = (row.name ?? '').toLowerCase();
		let value = 0;
		if (ref.startsWith('core.') || ref.startsWith('rewst.')) value += 100;
		if (ref === needle || name === needle) value += 50;
		if (ref.includes(needle) || name.includes(needle)) value += 10;
		if (row.deprecated) value -= 200;
		return value;
	};
	return [...rows].sort((a, b) => score(b) - score(a));
}

async function resolveActionIds(deps: GraphqlToolDeps, orgId: string, refs: string[]): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	for (const ref of refs) {
		const result = await deps.execute(ACTIONS_SEARCH_QUERY, { orgId, search: { ref: { _eq: ref } }, limit: 1 });
		const rows = (result.data as { actionsForOrg?: ActionRow[] } | undefined)?.actionsForOrg ?? [];
		const id = rows[0]?.id;
		if (!id) throw new Error(`Action ref "${ref}" not found in org ${orgId}.`);
		map.set(ref, id);
	}
	return map;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function cap(text: string): string {
	return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + '\n…(output truncated)' : text;
}

function summarizeWorkflow(w: RawWorkflow): string {
	const nameById = new Map(w.tasks.map(t => [t.id, t.name]));
	const label = (id: string): string => `${nameById.get(id) ?? '?'} (${id})`;

	const nodes = w.tasks.map(t => {
		const node: Record<string, unknown> = { id: t.id, name: t.name, action: t.action?.ref ?? t.actionId };
		if (t.input && Object.keys(t.input as object).length > 0) node.input = t.input;
		if (t.publishResultAs) node.publishResultAs = t.publishResultAs;
		if (t.transitionMode && t.transitionMode !== 'FOLLOW_ALL') node.transitionMode = t.transitionMode;
		if (t.with && (t.with.items || t.with.concurrency)) node.with = t.with;
		return node;
	});

	const edges: Record<string, unknown>[] = [];
	for (const t of w.tasks) {
		for (const transition of t.next ?? []) {
			const targets = (transition.do ?? []).map(label);
			const publish = normalizePublish(transition.publish);
			const edge: Record<string, unknown> = {
				from: t.name,
				when: transition.when ?? '{{ SUCCEEDED }}',
				to: targets,
			};
			if (transition.label) edge.label = transition.label;
			if (publish.length > 0) edge.publish = publish;
			if (transition.id) edge.transitionId = transition.id;
			edges.push(edge);
		}
	}

	const summary = {
		workflow: {
			id: w.id,
			name: w.name,
			description: w.description ?? undefined,
			orgId: w.orgId,
			type: w.type ?? undefined,
			inputs: w.input ?? [],
			versionToken: w.updatedAt,
		},
		nodes,
		edges,
		note: 'Edit with rewst_workflow_edit using task names from "nodes"; the version token is handled for you.',
	};
	return cap(JSON.stringify(summary, null, 1));
}

// ---------------------------------------------------------------------------
// Tool runners
// ---------------------------------------------------------------------------

// Availability is gated at registration time by the rewst-buddy.ai.enableWorkflowTools
// setting (see lmTools.ts); runToolRequests is only ever invoked per registered
// tool, so a disabled tool is never routed here. The remaining requirement is a
// live session to run GraphQL against.
function requireDeps(deps: GraphqlToolDeps | undefined): GraphqlToolDeps {
	if (!deps) {
		throw new Error(
			'No active Rewst session for the workflow tools (enable rewst-buddy.ai.enableWorkflowTools and sign in).',
		);
	}
	return deps;
}

async function runWorkflowGet(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const workflowId = asStringArg(request.args, 'workflowId');
	const orgId = asStringArg(request.args, 'orgId');
	if (!workflowId || !orgId) throw new Error('rewst_workflow_get requires "workflowId" and "orgId".');
	return summarizeWorkflow(await fetchWorkflow(deps, workflowId, orgId));
}

async function runActionSearch(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const orgId = asStringArg(request.args, 'orgId');
	if (!orgId) throw new Error('rewst_action_search requires "orgId".');
	const ref = asStringArg(request.args, 'ref');
	const actionId = asStringArg(request.args, 'actionId');

	if (ref || actionId) {
		const search = ref ? { ref: { _eq: ref } } : { id: { _eq: actionId } };
		const result = await deps.execute(ACTION_DESCRIBE_QUERY, { orgId, search });
		const row = (result.data as { actionsForOrg?: Record<string, unknown>[] } | undefined)?.actionsForOrg?.[0];
		if (!row) throw new Error(`Action ${ref ?? actionId} not found in org ${orgId}.`);
		return cap(JSON.stringify(row, null, 1));
	}

	const query = asStringArg(request.args, 'query');
	if (!query) throw new Error('rewst_action_search requires "query" (search) or "ref"/"actionId" (describe).');
	const includeDeprecated = request.args.includeDeprecated === true;
	const limit = typeof request.args.limit === 'number' ? Math.max(1, Math.min(50, request.args.limit)) : 15;

	const [byName, byRef] = await Promise.all([
		searchActions(deps, orgId, 'name', query, includeDeprecated, limit * 2),
		searchActions(deps, orgId, 'ref', query, includeDeprecated, limit * 2),
	]);
	const deduped = new Map<string, ActionRow>();
	for (const row of [...byName, ...byRef]) if (row.id) deduped.set(row.id, row);
	const ranked = rankActions([...deduped.values()], query).slice(0, limit);
	if (ranked.length === 0) return `No actions match "${query}" in org ${orgId}.`;
	const lines = ranked.map(
		row =>
			`- ${row.ref} — ${row.name}${row.category ? ` [${row.category}]` : ''}${row.deprecated ? ' (deprecated)' : ''} (id ${row.id})`,
	);
	return cap(
		`Actions matching "${query}":\n${lines.join('\n')}\n\nDescribe one with rewst_action_search {"orgId","ref"} to see its input parameters.`,
	);
}

async function runWorkflowEdit(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const workflowId = asStringArg(request.args, 'workflowId');
	const orgId = asStringArg(request.args, 'orgId');
	const missing = MUTATION_SCOPE_KEYS.filter(key => !asStringArg(request.args, key));
	if (missing.length > 0) {
		throw new Error(
			`rewst_workflow_edit requires non-empty ${MUTATION_SCOPE_KEYS.join(', ')} (get them from rewst_workflow_get). Missing: ${missing.join(', ')}.`,
		);
	}
	const operations = request.args.operations;
	if (!Array.isArray(operations) || operations.length === 0) {
		throw new Error('rewst_workflow_edit requires a non-empty "operations" array.');
	}
	const comment = asStringArg(request.args, 'comment') ?? 'Edited by Cage-Free Rewsty';

	const workflow = await fetchWorkflow(deps, workflowId!, orgId!);
	const actionIdByRef = await resolveActionIds(deps, orgId!, actionRefsIn(operations as WorkflowOperation[]));

	const apply = (source: RawWorkflow) =>
		applyOperations(source.tasks, operations as WorkflowOperation[], actionIdByRef);

	let { tasks, applied } = apply(workflow);
	let input = workflowToInput(workflow, tasks);
	let result = await deps.execute(WORKFLOW_UPDATE_MUTATION, {
		workflow: input,
		openedAt: workflow.updatedAt,
		comment,
	});

	// Conflict: someone saved between our read and write. Re-read fresh state,
	// re-apply the same operations (they are relative), and retry once.
	let error = firstErrorMessage(result);
	if (error && /newer version/i.test(error)) {
		const fresh = await fetchWorkflow(deps, workflowId!, orgId!);
		({ tasks, applied } = apply(fresh));
		input = workflowToInput(fresh, tasks);
		result = await deps.execute(WORKFLOW_UPDATE_MUTATION, {
			workflow: input,
			openedAt: fresh.updatedAt,
			comment,
		});
		error = firstErrorMessage(result);
	}
	if (error) throw new Error(`updateWorkflow failed: ${error}`);

	const updated = (result.data as { updateWorkflow?: { updatedAt?: string } } | undefined)?.updateWorkflow;
	return `Applied ${applied.length} operation(s) to "${workflow.name}":\n${applied.map(line => `- ${line}`).join('\n')}\n\nSaved. New version token: ${updated?.updatedAt ?? '(unknown)'}.`;
}

export async function runWorkflowTool(request: ToolRequest, deps: GraphqlToolDeps | undefined): Promise<string> {
	const bound = requireDeps(deps);
	switch (request.tool) {
		case 'rewst_workflow_get':
			return runWorkflowGet(request, bound);
		case 'rewst_action_search':
			return runActionSearch(request, bound);
		case WORKFLOW_EDIT_TOOL_NAME:
			return runWorkflowEdit(request, bound);
		default:
			throw new Error(`Unknown workflow tool "${request.tool}".`);
	}
}

// ---------------------------------------------------------------------------
// Mutation approval integration (mirrors graphqlTool's scope machinery)
// ---------------------------------------------------------------------------

/** The org+workflow a rewst_workflow_edit request targets, if fully specified. */
export function workflowEditScope(name: string, input: unknown): MutationScope | undefined {
	if (name !== WORKFLOW_EDIT_TOOL_NAME) return undefined;
	const args = asObject(input);
	const workflowId = str(args.workflowId);
	const workflowName = str(args.workflowName);
	const orgId = str(args.orgId);
	const orgName = str(args.orgName);
	if (!workflowId || !workflowName || !orgId || !orgName) return undefined;
	return { scopeId: workflowId, scopeName: workflowName, orgId, orgName };
}

function describeOperation(operation: WorkflowOperation): string {
	const op = operation.op;
	const detail =
		str(operation.name) ??
		str(operation.from) ??
		str(operation.id) ??
		(str(operation.from) && str(operation.to) ? `${str(operation.from)}->${str(operation.to)}` : undefined);
	return detail ? `${op} ${detail}` : String(op);
}

/**
 * The inline approval prompt for a rewst_workflow_edit request, or undefined
 * when no prompt is needed (not an edit, already approved this session, or
 * missing scope fields — refused downstream). Summarizes the operations so the
 * user sees what will change before approving.
 */
export function workflowEditConfirmation(name: string, input: unknown): GraphqlMutationConfirmation | undefined {
	const scope = workflowEditScope(name, input);
	if (!scope || isMutationScopeApproved(scope)) return undefined;
	const args = asObject(input);
	const operations = Array.isArray(args.operations) ? (args.operations as WorkflowOperation[]) : [];
	const lines = [
		`Edit workflow **${scope.scopeName}** (\`${scope.scopeId}\`) in org **${scope.orgName}** (\`${scope.orgId}\`)? Approving also lets further edits to this same workflow run for the rest of this session without asking again.`,
		'',
		'Operations:',
		...operations.map(operation => `- ${describeOperation(operation)}`),
	];
	return {
		title: 'Cage-Free Rewsty wants to edit a Rewst workflow',
		message: lines.join('\n'),
	};
}
