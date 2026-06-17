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
export const WORKFLOW_AUTOLAYOUT_TOOL_NAME = 'rewst_workflow_autolayout';

/** Identifying fields a workflow-mutation request must carry (org + workflow). */
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
			'Edit a Rewst workflow by applying high-level operations. The tool reads the current workflow, applies the operations to the full graph, and saves it back with conflict detection and an undoable patch — you never resend the whole workflow or manage version tokens yourself. Operations (each an object with an "op" field): add_task {name, action (ref or id) OR subWorkflowId, input?, publishResultAs?, transitionMode?, join?, with?, x?, y?}; update_task {id|name, set:{...}}; delete_task {id|name} (also removes edges pointing at it); connect {from, to, when?, label?, publish?} (from/to are task names or ids); disconnect {from, to?|transitionId?}; set_transition {from, to?|transitionId?, set:{when?, label?, publish?, to?}}; reposition {task, x, y} (move a task to canvas coordinates); set_inputs {inputs: [{name, type?, title?, default?, description?, required?, multiline?}]} (replace the workflow\'s run/call inputs; an input default is a Jinja expression like "{{ false }}" or "{{ CTX.x }}" — raw booleans/numbers are wrapped for you). Define workflow inputs ONLY with set_inputs: it writes the input name list, the action parameters that actually drive the run/call form, and the inputSchema together. Do not put inputs in varsSchema, which is a separate variables map. To call another workflow as a sub-workflow, set subWorkflowId (or action) to that workflow\'s id — a workflow\'s id is its action id; there is no separate run-workflow action. To branch on what a task returned, read RESULT.<field> in that task\'s own outgoing transition conditions, or CTX.<alias>.<field> when the task sets publishResultAs to <alias>; a task\'s or sub-workflow\'s internally published variables are NOT in this workflow\'s CTX. when defaults to "{{ SUCCEEDED }}". A new task is positioned on the canvas below the action it is connected from (leaving a gap) unless you pass x/y; x is canvas right, y is down, in free pixels. This is a mutation: it MUST include workflowId, workflowName, orgId, orgName (get them from rewst_workflow_get) and requires user approval, remembered per workflow for the session.',
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
	{
		name: WORKFLOW_AUTOLAYOUT_TOOL_NAME,
		args: '{"workflowId": string, "workflowName": string, "orgId": string, "orgName": string, "comment"?: string}',
		description:
			'Auto-arrange a Rewst workflow: recompute every task position into a clean top-down layout (each task one layer below the actions that lead to it, laid left-to-right with spacing), then save. Use this to tidy a messy or programmatically built workflow, or after adding several tasks. This is a mutation: it MUST include workflowId, workflowName, orgId, orgName (get them from rewst_workflow_get) and requires user approval, remembered per workflow for the session. For positioning a single task, use rewst_workflow_edit with a reposition operation instead.',
		inputSchema: {
			type: 'object',
			properties: {
				workflowId: { type: 'string', description: 'The workflow id to lay out.' },
				workflowName: { type: 'string', description: 'The workflow name, shown in the approval prompt.' },
				orgId: { type: 'string', description: 'The id of the org that owns the workflow.' },
				orgName: { type: 'string', description: 'The org name, shown in the approval prompt.' },
				comment: { type: 'string', description: 'Optional patch comment describing the change.' },
			},
			required: ['workflowId', 'workflowName', 'orgId', 'orgName'],
		},
	},
	{
		name: 'rewst_render_jinja',
		args: '{"orgId": string, "template": string, "executionId"?: string, "vars"?: object, "contextIndex"?: number}',
		description:
			"Render a Jinja template against a real workflow execution's context and return only the result. Use this to CONFIRM a transition condition, task input, or publish expression evaluates the way you expect BEFORE editing a workflow — the agent otherwise guesses wrong (e.g. comparing a boolean to the string 'true', or reading a sub-workflow result from CTX.<field> instead of CTX.<publishResultAs>.<field>). Pass executionId and the tool fetches that run's context server-side, so the (large) context never enters the chat; or pass vars as an ad-hoc context object. In the template, CTX is the execution context. By default the last context snapshot of the run is used; contextIndex picks another. Returns the rendered value, or the Jinja error if it fails.",
		inputSchema: {
			type: 'object',
			properties: {
				orgId: { type: 'string', description: 'The org the template renders in.' },
				template: {
					type: 'string',
					description: 'The Jinja to evaluate, e.g. "{{ CTX.learning_result.proceed | d(false) }}".',
				},
				executionId: {
					type: 'string',
					description:
						'A workflow execution id; its context is fetched server-side and used as CTX (kept out of the chat).',
				},
				vars: {
					type: 'object',
					description: 'Ad-hoc context object to render against instead of an execution.',
				},
				contextIndex: {
					type: 'number',
					description: 'Which context snapshot of the execution to use (default: the last/most-complete).',
				},
			},
			required: ['orgId', 'template'],
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
	organization?: { id?: string | null; name?: string | null } | null;
	action?: { parameters?: Record<string, unknown> | null } | null;
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
		organization { id name }
		action { parameters }
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
	if (w.inputSchema != null) input.inputSchema = w.inputSchema;
	if (w.outputSchema != null) input.outputSchema = w.outputSchema;
	if (w.varsSchema != null) input.varsSchema = w.varsSchema;
	if (w.metadata != null) input.metadata = w.metadata;
	if (w.timeout != null) input.timeout = w.timeout;
	// Workflow-level edits (e.g. set_inputs) win over the read-back values.
	return Object.assign(input, overrides);
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

// Canvas geometry, calibrated from a hand-arranged workflow (see
// scripts/WORKFLOW_API_FINDINGS.md): node.metadata.{x,y} is the node's top-left
// anchor in free (un-snapped) canvas coordinates. A node is ~NODE_HEIGHT tall;
// its width grows with its outgoing transition count (each transition adds an
// output port), ~WIDTH_BASE + WIDTH_PER_TRANSITION * transitions. We never place
// nodes flush, so layout leaves a gap of V_GAP / H_GAP between footprints.
const NODE_HEIGHT = 88;
const WIDTH_BASE = 209;
const WIDTH_PER_TRANSITION = 127;
const V_GAP = 80;
const H_GAP = 80;

/** Estimated rendered width of a node from its outgoing transition count. */
function nodeWidth(task: RawTask): number {
	return WIDTH_BASE + WIDTH_PER_TRANSITION * Math.max(1, (task.next ?? []).length);
}

/** A task's canvas position, if its metadata carries numeric x/y. */
function positionOf(task: RawTask): { x: number; y: number } | undefined {
	const metadata = task.metadata;
	if (metadata && typeof metadata === 'object') {
		const { x, y } = metadata as { x?: unknown; y?: unknown };
		if (typeof x === 'number' && typeof y === 'number') return { x, y };
	}
	return undefined;
}

function setPosition(task: RawTask, x: number, y: number): void {
	const metadata = task.metadata && typeof task.metadata === 'object' ? { ...(task.metadata as object) } : {};
	task.metadata = { ...metadata, x, y };
}

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Whether two footprints overlap (touching edges count as clear). */
function overlaps(a: Box, b: Box): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Places any task that still lacks a position: directly below the action it is
 * connected from (same column, one node-height-plus-gap down), or below the
 * lowest existing node when it has no parent. If the spot (padded by the gap)
 * would overlap an existing node, it is nudged right by a node width until clear.
 * Existing positions are never moved. This is how the tools determine spacing
 * between actions for newly added tasks.
 */
function layoutNewTasks(tasks: RawTask[]): void {
	const placed: Box[] = [];
	for (const task of tasks) {
		const position = positionOf(task);
		if (position) placed.push({ x: position.x, y: position.y, w: nodeWidth(task), h: NODE_HEIGHT });
	}
	const baseX = placed.length ? Math.min(...placed.map(b => b.x)) : 0;
	const lowestBottom = placed.length ? Math.max(...placed.map(b => b.y + b.h)) : 0;

	for (const task of tasks) {
		if (positionOf(task)) continue;
		const parent = tasks.find(candidate => (candidate.next ?? []).some(t => (t.do ?? []).includes(task.id)));
		const parentBox = parent
			? placed.find(b => positionOf(parent)?.x === b.x && positionOf(parent)?.y === b.y)
			: undefined;
		const w = nodeWidth(task);
		let x = parentBox ? parentBox.x : baseX;
		const y = parentBox ? parentBox.y + NODE_HEIGHT + V_GAP : lowestBottom + V_GAP;
		// Pad the candidate footprint by the gap and slide right until it clears.
		const padded = (): Box => ({ x: x - H_GAP, y: y - V_GAP, w: w + 2 * H_GAP, h: NODE_HEIGHT + 2 * V_GAP });
		while (placed.some(box => overlaps(padded(), box))) x += w + H_GAP;
		setPosition(task, x, y);
		placed.push({ x, y, w, h: NODE_HEIGHT });
	}
}

// One vertical row per rank.
const ROW_STEP = NODE_HEIGHT + V_GAP;

// A terminal node fed by more than this many actions is treated as a shared
// "catch" rather than a normal endpoint (workflow guidelines expect at most one
// action feeding an end node). Such a catch is pulled out of the main ranking
// and placed in a lane to the right, so it doesn't drag long edges across every
// rank. The feeder-span guard keeps the workflow's natural end node — fed by a
// few adjacent final branches — in the main flow.
const SIDE_HANDLER_MIN_FEEDERS = 2; // strictly more than 2 feeders
const SIDE_HANDLER_MIN_SPAN = 5; // feeders must span at least this many ranks
const LANE_GAP = 2 * H_GAP;

/** Ordered, de-duplicated forward child ids of a task, in transition order. */
function orderedChildren(task: RawTask, ids: Set<string>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const transition of task.next ?? []) {
		for (const target of transition.do ?? []) {
			if (ids.has(target) && !seen.has(target)) {
				seen.add(target);
				out.push(target);
			}
		}
	}
	return out;
}

/**
 * Re-lays-out every task as a layered flow, hand-rolled so within-rank order
 * strictly follows transition order and loops read the way Rewst flows do:
 *
 *  - Cycles are broken by DFS; an edge back to a node still on the stack is a
 *    back-edge (a retry loop's return). Ranks come from the longest path on the
 *    remaining acyclic graph, so every rank is a single row.
 *  - A back-edge's source is pulled to its target's rank, so a loop stays compact
 *    instead of dropping the loop node down with the exit tasks (delay sits on
 *    executions' row, not below can_proceed).
 *  - A terminal "catch" — a near-terminal task fed by more than two actions whose
 *    feeders span many ranks (e.g. a global failure_catch) — is lifted out of the
 *    main ranking and placed in a lane to the right, centered on its feeders, so
 *    it doesn't drag long edges down across every rank.
 *  - Within each rank, tasks are ordered strictly by a transition-order pre-order
 *    walk: if transition a comes before transition b, task a is left of task b.
 *  - X coordinates pack left-to-right without overlap, then a few barycenter
 *    sweeps center parents over their children. y is rank * (height + gap).
 *
 * Deterministic for a given task/transition order. Overwrites all positions.
 */
export function autoLayout(tasks: RawTask[]): void {
	if (tasks.length === 0) return;
	const ids = new Set(tasks.map(t => t.id));
	const byId = new Map(tasks.map(t => [t.id, t]));
	const children = new Map(tasks.map(t => [t.id, orderedChildren(t, ids)]));
	const edgeKey = (u: string, v: string) => `${u} ${v}`;
	const firstId = tasks[0].id;
	const width = (id: string) => nodeWidth(byId.get(id)!);

	// 1. Break cycles: DFS flags edges to a node on the current stack as back-edges.
	const backEdges = new Set<string>();
	const visited = new Set<string>();
	const stack = new Set<string>();
	const dfs = (u: string): void => {
		visited.add(u);
		stack.add(u);
		for (const v of children.get(u)!) {
			if (stack.has(v)) backEdges.add(edgeKey(u, v));
			else if (!visited.has(v)) dfs(v);
		}
		stack.delete(u);
	};
	const indegree = new Map(tasks.map(t => [t.id, 0]));
	for (const t of tasks) for (const v of children.get(t.id)!) indegree.set(v, (indegree.get(v) ?? 0) + 1);
	const roots = tasks.filter(t => (indegree.get(t.id) ?? 0) === 0).map(t => t.id);
	for (const r of roots.length ? roots : [firstId]) if (!visited.has(r)) dfs(r);
	for (const t of tasks) if (!visited.has(t.id)) dfs(t.id);

	const forwardChildren = (u: string) => children.get(u)!.filter(v => !backEdges.has(edgeKey(u, v)));
	const forwardParents = new Map<string, string[]>(tasks.map(t => [t.id, []]));
	for (const t of tasks) for (const v of forwardChildren(t.id)) forwardParents.get(v)!.push(t.id);

	// Longest-path ranks over a node subset (edges to non-members are ignored).
	const computeRanks = (members: Set<string>): Map<string, number> => {
		const rank = new Map<string, number>();
		const pending = new Map<string, number>();
		for (const id of members) {
			rank.set(id, 0);
			pending.set(id, 0);
		}
		for (const id of members)
			for (const v of forwardChildren(id)) if (members.has(v)) pending.set(v, pending.get(v)! + 1);
		const queue = [...members].filter(id => pending.get(id) === 0);
		while (queue.length) {
			const u = queue.shift()!;
			for (const v of forwardChildren(u)) {
				if (!members.has(v)) continue;
				if (rank.get(v)! < rank.get(u)! + 1) rank.set(v, rank.get(u)! + 1);
				pending.set(v, pending.get(v)! - 1);
				if (pending.get(v) === 0) queue.push(v);
			}
		}
		return rank;
	};

	// 2. Detect terminal catch nodes (in-degree > 2, feeders spanning many ranks)
	//    and lay out the main flow without them.
	const rankAll = computeRanks(ids);
	const isSideHandler = (id: string): boolean => {
		const feeders = forwardParents.get(id)!;
		if (feeders.length <= SIDE_HANDLER_MIN_FEEDERS) return false;
		if (forwardChildren(id).length > 1) return false; // near-terminal only
		const feederRanks = feeders.map(p => rankAll.get(p)!);
		return Math.max(...feederRanks) - Math.min(...feederRanks) >= SIDE_HANDLER_MIN_SPAN;
	};
	const sideHandlers = tasks.filter(t => isSideHandler(t.id)).map(t => t.id);
	const sideSet = new Set(sideHandlers);
	const mainSet = new Set(tasks.filter(t => !sideSet.has(t.id)).map(t => t.id));
	const mainIds = [...mainSet];

	// 3. Rank the main flow, then apply the loop exception to its back-edges.
	const rank = mainSet.size ? computeRanks(mainSet) : new Map<string, number>();
	for (const key of backEdges) {
		const [u, v] = key.split(' ');
		if (mainSet.has(u) && mainSet.has(v)) rank.set(u, rank.get(v)!);
	}

	// 4. Transition-order pre-order over the main flow drives within-rank order.
	const seq = new Map<string, number>();
	let counter = 0;
	const order = (u: string): void => {
		if (seq.has(u)) return;
		seq.set(u, counter++);
		for (const v of forwardChildren(u)) if (mainSet.has(v)) order(v);
	};
	const mainIndegree = new Map(mainIds.map(id => [id, 0]));
	for (const id of mainIds)
		for (const v of forwardChildren(id)) if (mainSet.has(v)) mainIndegree.set(v, mainIndegree.get(v)! + 1);
	const mainRoots = mainIds.filter(id => mainIndegree.get(id) === 0);
	for (const r of mainRoots.length ? mainRoots : mainIds) order(r);
	for (const id of mainIds) order(id);

	// 5. Group the main flow into rank rows, ordered by transition sequence.
	const layers = new Map<number, string[]>();
	for (const id of mainIds) {
		const r = rank.get(id)!;
		if (!layers.has(r)) layers.set(r, []);
		layers.get(r)!.push(id);
	}
	for (const layer of layers.values()) layer.sort((a, b) => seq.get(a)! - seq.get(b)!);

	// 6. X coordinates: pack each row, then barycenter sweeps center over neighbors.
	const x = new Map<string, number>();
	const ranks = [...layers.keys()].sort((a, b) => a - b);
	for (const r of ranks) {
		let cursor = 0;
		for (const id of layers.get(r)!) {
			x.set(id, cursor);
			cursor += width(id) + H_GAP;
		}
	}
	const mainChildren = (id: string) => forwardChildren(id).filter(v => mainSet.has(v));
	const mainParents = new Map<string, string[]>(mainIds.map(id => [id, []]));
	for (const id of mainIds) for (const v of mainChildren(id)) mainParents.get(v)!.push(id);
	const center = (id: string) => x.get(id)! + width(id) / 2;
	const placeRow = (row: string[], desired: Map<string, number>) => {
		let prevRight = -Infinity;
		for (const id of row) {
			const target = desired.has(id) ? desired.get(id)! : center(id);
			const left = Math.max(target - width(id) / 2, prevRight + H_GAP);
			x.set(id, left);
			prevRight = left + width(id);
		}
	};
	for (let sweep = 0; sweep < 8; sweep++) {
		const downward = sweep % 2 === 0;
		for (const r of downward ? ranks : [...ranks].reverse()) {
			const desired = new Map<string, number>();
			for (const id of layers.get(r)!) {
				const neighbors = downward ? mainParents.get(id)! : mainChildren(id);
				if (neighbors.length) {
					desired.set(id, neighbors.reduce((sum, n) => sum + center(n), 0) / neighbors.length);
				}
			}
			placeRow(layers.get(r)!, desired);
		}
	}

	// 7. Write the main flow as top-left anchors, normalized so the left edge is 0.
	const minX = mainIds.length ? Math.min(...mainIds.map(id => x.get(id)!)) : 0;
	for (const id of mainIds) setPosition(byId.get(id)!, Math.round(x.get(id)! - minX), rank.get(id)! * ROW_STEP);

	// 8. Place catch nodes in a lane to the right, each centered on its feeders'
	//    rows and stacked so they never overlap.
	if (sideHandlers.length) {
		const mainRight = mainIds.length ? Math.max(...mainIds.map(id => x.get(id)! - minX + width(id))) : 0;
		const laneX = mainRight + LANE_GAP;
		const centroidY = (id: string): number => {
			const feeders = forwardParents.get(id)!.filter(p => mainSet.has(p));
			const source = feeders.length ? feeders.map(p => rank.get(p)!) : [rankAll.get(id)!];
			return (source.reduce((sum, r) => sum + r, 0) / source.length) * ROW_STEP;
		};
		let prevBottom = -Infinity;
		for (const id of [...sideHandlers].sort((a, b) => centroidY(a) - centroidY(b))) {
			const y = Math.max(Math.round(centroidY(id)), prevBottom + V_GAP);
			setPosition(byId.get(id)!, laneX, y);
			prevBottom = y + NODE_HEIGHT;
		}
	}
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
): { tasks: RawTask[]; applied: string[]; workflow: Record<string, unknown> } {
	const next: RawTask[] = tasks.map(t => ({
		...t,
		next: (t.next ?? []).map(n => ({ ...n, do: [...(n.do ?? [])] })),
	}));
	const applied: string[] = [];
	// Workflow-level field changes (e.g. set_inputs) collected here, applied over
	// the read-back workflow when it is converted to WorkflowInput.
	const workflow: Record<string, unknown> = {};

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
				// A sub-workflow call is a task whose action is the target workflow's id
				// (a workflow's id doubles as its action id); there is no run-workflow action.
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
					input: asObject(operation.input),
					metadata: {},
					transitionMode: str(operation.transitionMode) ?? 'FOLLOW_ALL',
					next: [],
				};
				if (str(operation.publishResultAs) != null) task.publishResultAs = str(operation.publishResultAs);
				if (typeof operation.join === 'number') task.join = operation.join;
				if (typeof operation.timeout === 'number') task.timeout = operation.timeout;
				if (operation.with && typeof operation.with === 'object') task.with = operation.with as RawTask['with'];
				// Explicit position wins; otherwise layoutNewTasks places it below its parent.
				if (typeof operation.x === 'number' && typeof operation.y === 'number') {
					setPosition(task, operation.x, operation.y);
				}
				next.push(task);
				applied.push(
					`add_task ${name} (${id}) ${subWorkflowId ? `subWorkflow=${subWorkflowId}` : `action=${action}`}`,
				);
				break;
			}
			case 'update_task': {
				const ref = str(operation.id) ?? str(operation.name);
				if (!ref) throw new Error('update_task requires "id" or "name".');
				const task = resolveTask(next, ref);
				const set = asObject(operation.set);
				if (str(set.name)) task.name = str(set.name)!;
				if ('input' in set) task.input = set.input;
				if (str(set.subWorkflowId)) task.actionId = str(set.subWorkflowId)!;
				else if (str(set.action)) task.actionId = resolveActionId(str(set.action)!);
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
				const ref = str(operation.task) ?? str(operation.id) ?? str(operation.name);
				if (!ref) throw new Error('reposition requires "task" (a task id or name).');
				if (typeof operation.x !== 'number' || typeof operation.y !== 'number') {
					throw new Error('reposition requires numeric "x" and "y" canvas coordinates.');
				}
				const task = resolveTask(next, ref);
				setPosition(task, operation.x, operation.y);
				applied.push(`reposition ${task.name} -> (${operation.x}, ${operation.y})`);
				break;
			}
			case 'autolayout': {
				autoLayout(next);
				applied.push(`autolayout (${next.length} node(s) re-arranged)`);
				break;
			}
			case 'set_inputs': {
				// Workflow inputs (the run/call form in the UI) are driven by the
				// ordered input name list plus `parameters` (the action-parameter form:
				// label/required/multiline) — with inputSchema kept in step. They are
				// NOT varsSchema (trigger variables). The Rewst builder sets all three;
				// we mirror that so inputs actually appear in the UI.
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
					// Rewst defaults are Jinja-expression strings ("{{ false }}", "{{ 5 }}",
					// "{{ CTX.x }}"); a raw boolean/number won't render. Wrap raw scalars,
					// pass strings through (they may already be an expression or a literal).
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
			default:
				throw new Error(`Unknown operation "${op}".`);
		}
	}
	layoutNewTasks(next);
	return { tasks: next, applied, workflow };
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

const EXECUTION_CONTEXTS_QUERY = `query RewstBuddyExecutionContexts($id: ID!) {
	workflowExecutionContexts(workflowExecutionId: $id)
}`;

// renderJinja evaluates a template; `vars` becomes the CTX namespace. No side effects.
const RENDER_JINJA_MUTATION = `mutation RewstBuddyRenderJinja($orgId: ID!, $template: String!, $vars: JSON) {
	renderJinja(orgId: $orgId, template: $template, vars: $vars)
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
		const position = positionOf(t);
		if (position) node.position = position;
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

	// Workflow inputs come from the ordered name list + the action parameters
	// (the action-parameter form that drives the UI input/run form).
	const paramDefs =
		w.action?.parameters && typeof w.action.parameters === 'object'
			? (w.action.parameters as Record<string, Record<string, unknown>>)
			: {};
	const inputs = (w.input ?? []).map(name => {
		const def = paramDefs[name] ?? {};
		const entry: Record<string, unknown> = { name, type: def.type ?? 'string' };
		const title = def.label ?? def.title;
		if (title) entry.title = title;
		if (def.required === true) entry.required = true;
		if (def.default !== undefined && def.default !== '') entry.default = def.default;
		if (def.description) entry.description = def.description;
		return entry;
	});

	const summary = {
		workflow: {
			id: w.id,
			name: w.name,
			description: w.description ?? undefined,
			orgId: w.orgId,
			orgName: w.organization?.name ?? undefined,
			type: w.type ?? undefined,
			inputs,
			versionToken: w.updatedAt,
		},
		nodes,
		edges,
		note: 'To edit or auto-layout, pass these workflow fields straight through: workflowId=workflow.id, workflowName=workflow.name, orgId=workflow.orgId, orgName=workflow.orgName (use the names, not the ids). The version token is handled for you. node.position is the canvas {x,y} top-left anchor in free pixels (x right, y down); new tasks are auto-placed below the action they connect from unless you pass x/y. To call another workflow, use add_task with subWorkflowId set to that workflow id (there is no run-workflow action). Branch on a task\'s output with RESULT.<field> in that task\'s transitions, or CTX.<publishResultAs>.<field> — not CTX.<field>. "workflow.inputs" are the run/call parameters; change them with the set_inputs operation (do not hand-edit varsSchema). When troubleshooting a condition or expression, render it against a recent execution with rewst_render_jinja before editing — confirm it evaluates as you expect (types matter: a boolean is not the string "true").',
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
	// Calling another workflow isn't an action — steer away from the dead-end search.
	if (/\b(sub.?workflow|run.?workflow|call.?workflow|execute.?workflow)\b/i.test(query)) {
		return "Calling another workflow is not an action — there is no run-workflow action. To call a workflow as a sub-workflow, add a task with rewst_workflow_edit add_task and set subWorkflowId to the target workflow's id (a workflow's id is its action id). Find the target workflow id with your workflow-search tool.";
	}
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

async function runRenderJinja(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const orgId = asStringArg(request.args, 'orgId');
	const template = asStringArg(request.args, 'template');
	if (!orgId || !template) throw new Error('rewst_render_jinja requires "orgId" and "template".');

	// Resolve the render context (CTX). An executionId is fetched server-side so the
	// (large) run context never enters the chat; vars is an inline alternative.
	let vars = request.args.vars && typeof request.args.vars === 'object' ? (request.args.vars as object) : undefined;
	const executionId = asStringArg(request.args, 'executionId');
	if (executionId) {
		const result = await deps.execute(EXECUTION_CONTEXTS_QUERY, { id: executionId });
		const error = firstErrorMessage(result);
		if (error) throw new Error(`Failed to read execution context: ${error}`);
		const raw = (result.data as { workflowExecutionContexts?: unknown } | undefined)?.workflowExecutionContexts;
		const snapshots = Array.isArray(raw) ? raw : raw ? [raw] : [];
		if (snapshots.length === 0) throw new Error(`Execution ${executionId} has no context to render against.`);
		const requested =
			typeof request.args.contextIndex === 'number' ? request.args.contextIndex : snapshots.length - 1;
		const index = Math.max(0, Math.min(snapshots.length - 1, requested));
		vars = snapshots[index] as object;
	}
	if (!vars) {
		throw new Error(
			'rewst_render_jinja requires "executionId" (a run to use as context) or "vars" (an inline context).',
		);
	}

	const result = await deps.execute(RENDER_JINJA_MUTATION, { orgId, template, vars });
	const error = firstErrorMessage(result);
	if (error) throw new Error(`renderJinja failed: ${error}`);
	const rendered = (result.data as { renderJinja?: { result?: unknown; error?: unknown } } | undefined)?.renderJinja;
	if (rendered && typeof rendered === 'object' && 'error' in rendered && rendered.error) {
		return `Jinja error: ${typeof rendered.error === 'string' ? rendered.error : JSON.stringify(rendered.error)}`;
	}
	const value = rendered && typeof rendered === 'object' && 'result' in rendered ? rendered.result : rendered;
	return cap(`Rendered: ${JSON.stringify(value)} (type ${value === null ? 'null' : typeof value})`);
}

/** Validates the four scope fields a workflow mutation must carry. */
function requireScopeFields(toolName: string, args: Record<string, unknown>): { workflowId: string; orgId: string } {
	const missing = MUTATION_SCOPE_KEYS.filter(key => !asStringArg(args, key));
	if (missing.length > 0) {
		throw new Error(
			`${toolName} requires non-empty ${MUTATION_SCOPE_KEYS.join(', ')} (get them from rewst_workflow_get). Missing: ${missing.join(', ')}.`,
		);
	}
	return { workflowId: asStringArg(args, 'workflowId')!, orgId: asStringArg(args, 'orgId')! };
}

/**
 * The shared workflow write pipeline: resolve any action refs, read the current
 * workflow, apply the operations to the whole graph, and save with the correct
 * openedAt token — retrying once on a version conflict by re-reading and
 * re-applying (operations are relative). Used by both the edit and autolayout
 * tools.
 */
async function applyWorkflowMutation(
	deps: GraphqlToolDeps,
	workflowId: string,
	orgId: string,
	operations: WorkflowOperation[],
	comment: string,
): Promise<string> {
	const actionIdByRef = await resolveActionIds(deps, orgId, actionRefsIn(operations));
	const apply = (source: RawWorkflow) => applyOperations(source.tasks, operations, actionIdByRef);

	const workflow = await fetchWorkflow(deps, workflowId, orgId);
	let { tasks, applied, workflow: overrides } = apply(workflow);
	let result = await deps.execute(WORKFLOW_UPDATE_MUTATION, {
		workflow: workflowToInput(workflow, tasks, overrides),
		openedAt: workflow.updatedAt,
		comment,
	});

	let error = firstErrorMessage(result);
	if (error && /newer version/i.test(error)) {
		const fresh = await fetchWorkflow(deps, workflowId, orgId);
		({ tasks, applied, workflow: overrides } = apply(fresh));
		result = await deps.execute(WORKFLOW_UPDATE_MUTATION, {
			workflow: workflowToInput(fresh, tasks, overrides),
			openedAt: fresh.updatedAt,
			comment,
		});
		error = firstErrorMessage(result);
	}
	if (error) throw new Error(`updateWorkflow failed: ${error}`);

	const updated = (result.data as { updateWorkflow?: { name?: string; updatedAt?: string } } | undefined)
		?.updateWorkflow;
	return `Applied ${applied.length} operation(s) to "${workflow.name}":\n${applied.map(line => `- ${line}`).join('\n')}\n\nSaved. New version token: ${updated?.updatedAt ?? '(unknown)'}.`;
}

async function runWorkflowEdit(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const { workflowId, orgId } = requireScopeFields('rewst_workflow_edit', request.args);
	const operations = request.args.operations;
	if (!Array.isArray(operations) || operations.length === 0) {
		throw new Error('rewst_workflow_edit requires a non-empty "operations" array.');
	}
	const comment = asStringArg(request.args, 'comment') ?? 'Edited by Cage-Free Rewsty';
	return applyWorkflowMutation(deps, workflowId, orgId, operations as WorkflowOperation[], comment);
}

async function runWorkflowAutolayout(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const { workflowId, orgId } = requireScopeFields(WORKFLOW_AUTOLAYOUT_TOOL_NAME, request.args);
	const comment = asStringArg(request.args, 'comment') ?? 'Auto-laid out by Cage-Free Rewsty';
	return applyWorkflowMutation(deps, workflowId, orgId, [{ op: 'autolayout' }], comment);
}

export async function runWorkflowTool(request: ToolRequest, deps: GraphqlToolDeps | undefined): Promise<string> {
	const bound = requireDeps(deps);
	switch (request.tool) {
		case 'rewst_workflow_get':
			return runWorkflowGet(request, bound);
		case 'rewst_action_search':
			return runActionSearch(request, bound);
		case 'rewst_render_jinja':
			return runRenderJinja(request, bound);
		case WORKFLOW_EDIT_TOOL_NAME:
			return runWorkflowEdit(request, bound);
		case WORKFLOW_AUTOLAYOUT_TOOL_NAME:
			return runWorkflowAutolayout(request, bound);
		default:
			throw new Error(`Unknown workflow tool "${request.tool}".`);
	}
}

// ---------------------------------------------------------------------------
// Mutation approval integration (mirrors graphqlTool's scope machinery)
// ---------------------------------------------------------------------------

/** Tool names that mutate a workflow and share the per-workflow approval scope. */
const WORKFLOW_MUTATION_TOOLS = new Set<string>([WORKFLOW_EDIT_TOOL_NAME, WORKFLOW_AUTOLAYOUT_TOOL_NAME]);

/** The org+workflow a workflow-mutation request targets, if fully specified. */
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
	const lead = `workflow **${scope.scopeName}** (\`${scope.scopeId}\`) in org **${scope.orgName}** (\`${scope.orgId}\`)? Approving also lets further edits to this same workflow run for the rest of this session without asking again.`;
	const lines =
		name === WORKFLOW_AUTOLAYOUT_TOOL_NAME
			? [`Auto-layout ${lead}`, '', 'This re-arranges every task position on the canvas.']
			: [
					`Edit ${lead}`,
					'',
					'Operations:',
					...(Array.isArray(args.operations) ? (args.operations as WorkflowOperation[]) : []).map(
						operation => `- ${describeOperation(operation)}`,
					),
				];
	return {
		title: 'Cage-Free Rewsty wants to edit a Rewst workflow',
		message: lines.join('\n'),
	};
}
