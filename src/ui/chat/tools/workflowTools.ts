import { createHash, randomUUID } from 'crypto';
import {
	type GraphqlMutationConfirmation,
	type GraphqlToolDeps,
	isMutationScopeApproved,
	type MutationScope,
} from './graphqlTool';
import { asBooleanArg, asStringArg, type ToolRequest, type ToolSpec } from './toolProtocol';

/**
 * High-level Rewst workflow tools for RoboRewsty. These bundle the multi-step
 * GraphQL choreography that workflow editing otherwise requires into single
 * calls, so the assistant does not have to rediscover the API's quirks every
 * turn (see scripts/WORKFLOW_API_FINDINGS.md for the disparities these encode):
 *
 *   - buddy_workflow_get      read a workflow as a normalized node/edge graph.
 *   - buddy_action_search     find actions, or describe one action's inputs.
 *   - buddy_workflow_edit     apply high-level operations to a workflow safely.
 *
 * The edit tool always resends the FULL workflow (updateWorkflow replaces, it
 * does not merge), carries the correct optimistic-concurrency token (openedAt
 * must equal the updatedAt read at fetch time), and snapshots a patch so every
 * change is reversible. New task ids are de-dashed hex because the server
 * strips dashes from task ids but not from the `do` references that point at
 * them. Reads run directly; write helpers are gated by the MCP mutation
 * approval path before execution.
 */

export const WORKFLOW_EDIT_TOOL_NAME = 'buddy_workflow_edit';
export const WORKFLOW_AUTOLAYOUT_TOOL_NAME = 'buddy_workflow_autolayout';
export const WORKFLOW_RUN_TOOL_NAME = 'buddy_workflow_run';
export const WORKFLOW_EXECUTION_LOGS_TOOL_NAME = 'buddy_execution_logs';
export const WORKFLOW_SEARCH_TOOL_NAME = 'buddy_workflow_search';

/**
 * Running a workflow actually executes its automation, so it requires a fresh
 * approval every time and is never remembered per-session — unlike edit/autolayout.
 */
export function workflowToolAlwaysPrompts(name: string): boolean {
	return name === WORKFLOW_RUN_TOOL_NAME;
}

/** Identifying fields a workflow-mutation request must carry (org + workflow). */
const MUTATION_SCOPE_KEYS = ['workflowId', 'workflowName', 'orgId', 'orgName'] as const;

export const WORKFLOW_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'buddy_workflow_get',
		args: '{"workflowId": string, "orgId": string, "detail"?: "summary" (default) | "full"}',
		description:
			'Read a Rewst workflow as a normalized graph: nodes (tasks with their action ref and input) and edges (transitions with their condition, label, target task names, and published context variables). Returns far less noise than raw GraphQL and the node/edge names this tool uses are exactly what buddy_workflow_edit operations expect. detail defaults to "summary": a concise ANALYSIS view that OMITS task ids, transition ids, canvas x/y positions, and the version token and refers to tasks/edges by name. Summary is sufficient for understanding, explaining, and most name-based edits (buddy_workflow_edit operations resolve tasks by name). Pass detail "full" only when you need task ids, transition ids, or canvas positions, such as repositioning a task or targeting one specific transition by id.',
		inputSchema: {
			type: 'object',
			properties: {
				workflowId: { type: 'string', description: 'The workflow id.' },
				orgId: { type: 'string', description: 'The id of the org that owns the workflow.' },
				detail: {
					type: 'string',
					enum: ['summary', 'full'],
					description:
						'"summary" (default): concise analysis view for reading, understanding, and most name-based edits; no ids/positions/version token. "full": adds task ids, transition ids, and canvas positions — use only when you need task ids, transition ids, or canvas positions (repositioning a task or targeting a specific transition by id).',
				},
			},
			required: ['workflowId', 'orgId'],
		},
	},
	{
		name: WORKFLOW_SEARCH_TOOL_NAME,
		args: '{"query"?: string, "orgId"?: string, "refresh"?: boolean, "limit"?: number}',
		description:
			'Find Rewst workflows by name (or id) across every org you can access — the reliable way to resolve a workflow instead of guessing its id or paging through GraphQL. On first use it builds and CACHES an index of all workflows (id, name, org id, org name) reachable from your session — managed orgs and sub-orgs alike — then answers this and every later search from that one cached index with no re-listing. Pass query to match by name or id — matching ignores case, punctuation, and word order and requires every word, so "jon sandbox" finds "Jon\'s Sandbox" and "lock workflow" finds "[RAVEN] Workflow Lock". Workflows that match only because their ORG name matched are summarized separately (with the org id), so an org-name query never floods the list. orgId scopes to one org; limit caps results (default 25); refresh:true rebuilds the cache after workflows are created or renamed. Each result shows the workflow name, its id, and the ORG NAME (with org id) — feed those straight into buddy_workflow_get / buddy_workflow_edit / buddy_workflow_run.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Case-insensitive substring matched against workflow name, id, and org name. Omit to list.',
				},
				orgId: { type: 'string', description: 'Restrict results to one org id.' },
				refresh: {
					type: 'boolean',
					description: 'Rebuild the cached index from the API before searching (default false).',
				},
				limit: { type: 'number', description: 'Max results to return (default 25).' },
			},
		},
	},
	{
		name: 'buddy_action_search',
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
			'Edit a Rewst workflow by applying high-level operations. The tool reads the current workflow, applies the operations to the full graph, and saves it back with conflict detection and an undoable patch — you never resend the whole workflow or manage version tokens yourself. Operations (each an object with an "op" field): add_task {name, action (ref or id) OR subWorkflowId, input?, publishResultAs?, with?, x?, y?}; update_task {id|name, set:{name?, input?, action? or subWorkflowId?, publishResultAs?, timeout?, description?, with?}}; delete_task {id|name} (also removes edges pointing at it); connect {from, to, when?, label?, publish?} (from/to are task names or ids); disconnect {from, to?|transitionId?}; set_transition {from, to?|transitionId?, set:{when?, label?, publish?, to?}}; reposition {task, x, y} (move a task to canvas coordinates); set_inputs {inputs: [{name, type?, title?, default?, description?, required?, multiline?}]} (replace the workflow\'s run/call inputs; an input default is a Jinja expression like "{{ false }}" or "{{ CTX.x }}" — raw booleans/numbers are wrapped for you); set_output {outputs: {name: "<jinja>"} object or [{name, value}] array} (replace the workflow\'s caller-visible outputs; raw booleans/numbers are wrapped for you). Define workflow inputs ONLY with set_inputs: it writes the input name list, the action parameters that actually drive the run/call form, and the inputSchema together. Do not put inputs in varsSchema, which is a separate variables map. To call another workflow as a sub-workflow, set subWorkflowId (or action) to that workflow\'s id — a workflow\'s id is its action id; there is no separate run-workflow action. PREFER COMPOSITION over one giant canvas: give a chunky reusable sequence (ticket lifecycle, user lookup, license handling) its own workflow with set_inputs for its run inputs and set_output for its return values, then call it with add_task subWorkflowId — the calling task reads RESULT.<name> for exactly the names set_output declared (or CTX.<publishResultAs>.<name> when it sets publishResultAs). A single canvas growing past roughly 15-20 tasks with distinct concerns is a sign to split. To branch on what a task returned, read RESULT.<field> in that task\'s own outgoing transition conditions, or CTX.<alias>.<field> when the task sets publishResultAs to <alias>; a task\'s or sub-workflow\'s internally published variables are NOT in this workflow\'s CTX. At runtime a task follows at most one outgoing transition — the first, in listed order, whose condition holds — so a custom-condition edge followed by the "{{ SUCCEEDED }}" catch-all forms a clean two-way branch. when defaults to "{{ SUCCEEDED }}"; the tool automatically orders each task\'s transitions so custom conditions come before the success catch-all. A transition\'s publish entries apply whenever that transition is taken, including on {{ FAILED }} edges, and entries on one transition evaluate in order (a later entry can read an earlier one from CTX); transition publish is the only place to compute context variables — tasks have no publish of their own, only publishResultAs for their raw result. Inside a with.items loop task, reference the current element as the callable {{ item() }} (not CTX.item); when such a task sets publishResultAs, the published value is a list with one wrapper per item, each holding that item\'s result. It does not expose parallel task controls: new tasks use sequential graph defaults, and any `with.items` value is only per-action loop concurrency inside that one task. A new task is positioned on the canvas below the action it is connected from (leaving a gap) unless you pass x/y; x is canvas right, y is down, in free pixels. This is a mutation: it MUST include workflowId, workflowName, orgId, orgName (get them from buddy_workflow_get) and requires user approval, remembered per workflow for the session.',
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
			'Auto-arrange a Rewst workflow: recompute every task position into a clean top-down layout (each task one layer below the actions that lead to it, laid left-to-right with spacing), then save. Use this to tidy a messy or programmatically built workflow, or after adding several tasks. This is a mutation: it MUST include workflowId, workflowName, orgId, orgName (get them from buddy_workflow_get) and requires user approval, remembered per workflow for the session. For positioning a single task, use buddy_workflow_edit with a reposition operation instead.',
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
		name: WORKFLOW_RUN_TOOL_NAME,
		args: '{"workflowId": string, "workflowName": string, "orgId": string, "orgName": string, "input"?: object, "wait"?: boolean}',
		description:
			"Trigger a run of a Rewst workflow (via testWorkflow) — to test a workflow end to end or kick it off for another purpose. Pass input as the workflow's run inputs (the parameters from buddy_workflow_get's workflow.inputs). By default the tool WAITS for the run to finish and reports the final status; if it failed it automatically includes the failing task's log (status, message, input, result) so you see the cause in one call without a separate buddy_execution_logs round-trip. Pass wait:false to return immediately with just the execution id. The execution id is included either way; feed it to buddy_execution_logs or buddy_render_jinja to dig further. This actually executes the workflow's automation, so it requires user approval every time.",
		inputSchema: {
			type: 'object',
			properties: {
				workflowId: { type: 'string', description: 'The workflow id to run.' },
				workflowName: { type: 'string', description: 'The workflow name, shown in the approval prompt.' },
				orgId: { type: 'string', description: 'The id of the org that owns the workflow.' },
				orgName: { type: 'string', description: 'The org name, shown in the approval prompt.' },
				input: { type: 'object', description: "The workflow's run inputs (maps input name to value)." },
				wait: {
					type: 'boolean',
					description:
						'Wait for the run to finish and report its outcome (default true). False returns immediately.',
				},
			},
			required: ['workflowId', 'workflowName', 'orgId', 'orgName'],
		},
	},
	{
		name: 'buddy_workflow_executions',
		args: '{"workflowId": string, "orgId": string, "status"?: string, "limit"?: number, "rootOnly"?: boolean}',
		description:
			'List a workflow\'s recent executions, most recent first — typically to find recent FAILED runs to debug. Pass status to filter (e.g. "failed", "succeeded", "running"; lowercase). By default, searches root-level executions in the workflow\'s org; pass rootOnly:false for workflows that are only called as sub-workflows. Returns each execution\'s id, status, time, successful-task count, and parent/root execution links when present. Feed a failed execution\'s id to buddy_render_jinja (executionId) to inspect the context it produced and see why a condition or expression went wrong.',
		inputSchema: {
			type: 'object',
			properties: {
				workflowId: { type: 'string', description: 'The workflow whose executions to list.' },
				orgId: { type: 'string', description: 'The id of the org that owns the workflow.' },
				status: {
					type: 'string',
					description:
						'Filter by execution status, lowercase (e.g. "failed", "succeeded", "running"). Omit for any.',
				},
				limit: { type: 'number', description: 'Max executions to return (default 10).' },
				rootOnly: {
					type: 'boolean',
					description:
						'True/default searches root-level executions in the workflow org. False searches by workflow id only, which can find executions created when the workflow is called as a sub-workflow.',
				},
			},
			required: ['workflowId', 'orgId'],
		},
	},
	{
		name: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
		args: '{"executionId": string, "failedOnly"?: boolean, "includeResult"?: boolean}',
		description:
			"Inspect one workflow execution's task logs: per task, its status, and for failed tasks the message, the input it received, and the result it produced — the fastest way to see WHY a run failed, instead of hand-writing taskLogs GraphQL. Get an executionId from buddy_workflow_run or buddy_workflow_executions. By default every task shows name + status and failed tasks additionally show message, input, and result (truncated); pass includeResult to include every task's result, or failedOnly to list only failed tasks. A task's input shows exactly what it received (an empty-string id means the caller passed nothing); its result shows the real output shape — read it before assuming a wrapper key (e.g. some actions return a list directly, not { items: [...] }).",
		inputSchema: {
			type: 'object',
			properties: {
				executionId: { type: 'string', description: 'The workflow execution id to inspect.' },
				failedOnly: { type: 'boolean', description: 'List only failed tasks (default false).' },
				includeResult: {
					type: 'boolean',
					description: "Include every task's result, not just failed tasks' (default false).",
				},
			},
			required: ['executionId'],
		},
	},
	{
		name: 'buddy_render_jinja',
		args: '{"orgId": string, "template"?: string, "executionId"?: string, "vars"?: object, "contextIndex"?: number, "keys"?: boolean}',
		description:
			"Render a Jinja template against a real workflow execution's context and return only the result. Use this to CONFIRM a transition condition, task input, or publish expression evaluates the way you expect BEFORE editing a workflow — the agent otherwise guesses wrong (e.g. comparing a boolean to the string 'true', or reading a sub-workflow result from CTX.<field> instead of CTX.<publishResultAs>.<field>). Pass executionId and the tool fetches that run's context server-side, so the (large) context never enters the chat; or pass vars as an ad-hoc context object. This renders against the STORED context snapshot, which is the CTX namespace only — the live runtime objects WORKFLOW, ORG, USER, and RESULT do NOT exist here, so use their CTX equivalents: the execution id is CTX.execution_id, the org id is CTX.organization.id, and the running workflow's own id is CTX.trigger_instance.trigger.workflow_id. To discover what a run actually holds, pass keys:true to list the context's top-level keys instead of rendering (then drill in with {{ CTX.<key> }}). In the template, CTX is the context: read a field as {{ CTX.field }}, and to dump the whole context use {{ CTX() }} with parentheses — in a live Rewst workflow CTX is callable, so bare {{ CTX }} does not work. An execution's stored snapshots are per-publish deltas (each holds only the keys that publish wrote), so by default the tool merges them all, in order, into one cumulative context — the closest view of the run's final CTX; pass contextIndex to inspect one raw delta instead. Returns the rendered value, or the Jinja error if it fails.",
		inputSchema: {
			type: 'object',
			properties: {
				orgId: { type: 'string', description: 'The org the template renders in.' },
				template: {
					type: 'string',
					description:
						'The Jinja to evaluate, e.g. "{{ CTX.learning_result.proceed | d(false) }}". Omit when keys is true.',
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
					description:
						'Inspect a single raw snapshot (a per-publish delta) by index instead of the default merged context.',
				},
				keys: {
					type: 'boolean',
					description: "List the context's top-level keys instead of rendering a template (default false).",
				},
			},
			required: ['orgId'],
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

// A task's integration override: pins which pack config (integration connection)
// the action runs against instead of the org default. packId is required; the
// rest are optional. Dropping these on an edit silently reverts the task to the
// default integration, so they must round-trip.
interface PackOverride {
	configSelectionMode?: string | null;
	configFallbackMode?: string | null;
	packId: string;
	packConfigId?: string | null;
	searchInput?: string | null;
}

interface RawTask {
	id: string;
	name: string;
	actionId?: string | null;
	action?: { id?: string | null; ref?: string | null; name?: string | null } | null;
	description?: string | null;
	input?: unknown;
	packOverrides?: PackOverride[] | null;
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
	// The caller-visible return contract: an ordered [{name: "<jinja>"}] list a
	// sub-workflow renders at end of run — what its caller reads as RESULT.<name>.
	output?: unknown;
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

/** Strips a read-back pack override down to the fields PackOverrideInput accepts. */
function packOverrideToInput(o: PackOverride): Record<string, unknown> {
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
	// updateWorkflow replaces the whole task, so the per-task integration overrides
	// must be resent or every edit reverts the task to the default integration.
	if (t.packOverrides != null) input.packOverrides = t.packOverrides.map(packOverrideToInput);
	if (t.actionId) input.actionId = t.actionId;
	if (t.description != null) input.description = t.description;
	// Resend the task's own mode/join. The edit tooling never lets the model set a
	// fan-out, but a workflow can already carry a human-authored FOLLOW_ALL or join,
	// and updateWorkflow replaces the whole task — so dropping these would silently
	// rewrite an existing parallel branch to sequential on an unrelated edit.
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
	// The run/call form parameters live under action.parameters on read but are a
	// top-level WorkflowInput field on write. updateWorkflow replaces the whole
	// payload, so a non-input edit must carry them through or they are dropped
	// (set_inputs overrides this via the overrides arg below).
	if (w.action?.parameters != null) input.parameters = w.action.parameters;
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
	// Order transitions before reading them: within-rank placement follows
	// transition order, so custom conditions sit left of the success catch-all.
	orderTransitionsByCondition(tasks);
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

/**
 * Several task fields are JSON objects (`input`, `with`). MCP clients sometimes
 * deliver them as a JSON-encoded string; assigning that verbatim stores it as a
 * char-indexed blob ({"0":"{","1":"\"",...}) and breaks the task. Parse a JSON
 * string back to its object, treat null/undefined as empty, and reject anything
 * else (a non-object string, an array, a scalar) rather than silently corrupting
 * or wiping the field. `label` names the field in the error message.
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

/**
 * Numeric task settings are typed Int on the wire, so a float fails at the
 * mutation boundary just as a blind-cast string would. Coerce a numeric string
 * to a number and accept only integers, rejecting anything else with a clear
 * error. `label` names the field in the error message.
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

/**
 * This tool does not set task parallelism, so it drops any transitionMode/join a
 * caller passes (new tasks get sequential defaults; existing fan-out is preserved
 * from the read-back workflow). Returns a summary suffix naming what was dropped
 * so the change report tells the model rather than ignoring it silently.
 */
function droppedParallelControlsNote(source: Record<string, unknown>): string {
	const dropped = ['transitionMode', 'join'].filter(key => key in source);
	return dropped.length ? ` (ignored ${dropped.join('/')}: this tool does not set task parallelism)` : '';
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
					input: coerceTaskInput(operation.input),
					metadata: {},
					transitionMode: 'FOLLOW_FIRST',
					join: 1,
					next: [],
				};
				if (str(operation.publishResultAs) != null) task.publishResultAs = str(operation.publishResultAs);
				if (operation.timeout != null) task.timeout = coerceTaskNumber(operation.timeout, 'timeout');
				if (operation.with != null)
					task.with = coerceObjectField(operation.with, 'task "with"') as RawTask['with'];
				// Explicit position wins; otherwise layoutNewTasks places it below its parent.
				if (typeof operation.x === 'number' && typeof operation.y === 'number') {
					setPosition(task, operation.x, operation.y);
				}
				next.push(task);
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
				if (str(set.name)) task.name = str(set.name)!;
				if ('input' in set) task.input = coerceTaskInput(set.input);
				if (str(set.subWorkflowId)) task.actionId = str(set.subWorkflowId)!;
				else if (str(set.action)) task.actionId = resolveActionId(str(set.action)!);
				if ('publishResultAs' in set) task.publishResultAs = set.publishResultAs as string;
				if ('timeout' in set) task.timeout = coerceTaskNumber(set.timeout, 'timeout');
				if ('description' in set) task.description = set.description as string;
				if ('with' in set) task.with = coerceObjectField(set.with, 'task "with"') as RawTask['with'];
				applied.push(`update_task ${task.name} (${task.id})${droppedParallelControlsNote(set)}`);
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
				// A task saved once carries a terminal "{{ SUCCEEDED }}" transition with
				// no targets. Appending another success transition after it would let
				// that empty terminal shadow the new edge under FOLLOW_FIRST, so insert
				// the new success edge before the first targetless terminal.
				const existing = from.next ?? [];
				const terminalIndex = existing.findIndex(t => isSuccessCondition(t.when) && (t.do ?? []).length === 0);
				from.next =
					terminalIndex >= 0 && isSuccessCondition(transition.when)
						? [...existing.slice(0, terminalIndex), transition, ...existing.slice(terminalIndex)]
						: [...existing, transition];
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
				// NOT varsSchema: that declares the workflow's *variables* — inputs whose
				// values are set statically in each trigger's settings (Trigger.vars),
				// constant per trigger fire — as opposed to run/call inputs, which the
				// caller supplies per execution. set_inputs only edits inputs, never
				// varsSchema. The Rewst builder sets the three input fields together; we
				// mirror that so inputs actually appear in the UI.
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
			case 'set_output': {
				// The workflow's outputs are its return contract to callers: when
				// another workflow runs this one as a sub-workflow task, RESULT.<name>
				// (or CTX.<publishResultAs>.<name>) is exactly these entries, rendered
				// at end of run. Stored as the API's ordered [{name: "<jinja>"}] list.
				const raw = operation.outputs;
				if (raw == null || typeof raw !== 'object') {
					throw new Error(
						'set_output requires "outputs": a {name: "<jinja>"} object or [{name, value}] array (an empty array clears the outputs).',
					);
				}
				// Accept the natural {name, value} array spelling alongside the
				// {key, value} / object-map / single-key-object forms normalizePublish
				// already handles.
				const withKeys = Array.isArray(raw)
					? raw.map(entry => {
							const record = entry as Record<string, unknown>;
							return record &&
								typeof record === 'object' &&
								typeof record.name === 'string' &&
								'value' in record
								? { key: record.name, value: record.value }
								: entry;
						})
					: raw;
				const entries = normalizePublish(withKeys);
				// Output values are Jinja expression strings; wrap raw scalars the same
				// way set_inputs wraps defaults so a literal true/3 still renders.
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
	layoutNewTasks(next);
	return { tasks: next, applied, workflow };
}

/**
 * Rewst's runtime default for an unset task mode can fan out across every
 * matching transition. To remove that footgun from the edit tooling, fill the
 * safe sequential defaults (FOLLOW_FIRST, join 1) only where a task leaves them
 * unset — an intentional FOLLOW_ALL fan-out or explicit join is preserved.
 */
function ensureTaskDefaults(tasks: RawTask[]): void {
	for (const task of tasks) {
		if (!task.transitionMode) task.transitionMode = 'FOLLOW_FIRST';
		if (task.join == null) task.join = 1;
	}
}

/**
 * Every task must have at least one outgoing transition. A task that nothing
 * connects out of gets a terminal "{{ SUCCEEDED }}" transition with no targets —
 * the same shape Rewst uses for an end-of-branch task — so added/edited tasks are
 * never left with zero transitions.
 */
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
		// Only a truly empty fallback is redundant — a targetless success edge that
		// still publishes context is real work and must survive.
		task.next = transitions.filter(
			t => !(isSuccessCondition(t.when) && (t.do ?? []).length === 0 && (t.publish ?? []).length === 0),
		);
	}
}

/** A transition with no condition or the built-in {{ SUCCEEDED }} catch-all. */
function isSuccessCondition(when: string | null | undefined): boolean {
	const normalized = (when ?? '').replace(/[{}]/g, '').replace(/\s+/g, '').toUpperCase();
	return normalized === '' || normalized === 'SUCCEEDED';
}

/**
 * Within each task, custom-condition transitions must precede the success
 * ("{{ SUCCEEDED }}") catch-all. Under FOLLOW_FIRST the first transition whose
 * condition holds wins, and {{ SUCCEEDED }} is truthy on any success — so a
 * success transition listed first shadows every custom condition after it and
 * that custom Jinja never evaluates. Stable-partition keeps each group's order.
 */
function orderTransitionsByCondition(tasks: RawTask[]): void {
	for (const task of tasks) {
		const transitions = task.next;
		if (!transitions || transitions.length < 2) continue;
		const custom = transitions.filter(t => !isSuccessCondition(t.when));
		const success = transitions.filter(t => isSuccessCondition(t.when));
		if (custom.length > 0 && success.length > 0) task.next = [...custom, ...success];
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

const TEST_WORKFLOW_MUTATION = `mutation RewstBuddyTestWorkflow($id: ID!, $orgId: ID!, $input: JSON) {
	testWorkflow(id: $id, orgId: $orgId, input: $input) {
		executionId
	}
}`;

const WORKFLOW_EXECUTIONS_QUERY = `query RewstBuddyExecutions($where: WorkflowExecutionWhereInput, $order: [[String!]!], $limit: Int) {
	workflowExecutions(where: $where, order: $order, limit: $limit) {
		id status createdAt numSuccessfulTasks orgId originatingExecutionId parentExecutionId
	}
}`;

const TASK_LOGS_QUERY = `query RewstBuddyTaskLogs($where: TaskLogWhereInput) {
	taskLogs(where: $where, order: [["createdAt", "ASC"]]) {
		id originalWorkflowTaskName status message input result createdAt
	}
}`;

// Every workflow the session can reach, in one paginated query. Crucially this
// is NOT scoped by orgId: with no `where` the API returns workflows across the
// whole accessible hierarchy — managed orgs AND sub-orgs (which `managedOrgs`
// does not even list) — each carrying its `organization { name }`, so the index
// gets org names without any per-org lookup. Paginated via limit/offset.
const WORKFLOWS_INDEX_QUERY = `query RewstBuddyWorkflowsIndex($limit: Int, $offset: Int) {
	workflows(limit: $limit, offset: $offset, order: [["name", "asc"]]) {
		id name orgId organization { id name }
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

function formatWorkflowOutput(text: string): string {
	return text;
}

function summarizeWorkflow(w: RawWorkflow, detail: 'summary' | 'full' = 'summary'): string {
	const full = detail === 'full';
	const nameById = new Map(w.tasks.map(t => [t.id, t.name]));
	// In the analysis view, refer to targets by name; full view appends the id.
	const targetRef = (id: string): string => (full ? `${nameById.get(id) ?? '?'} (${id})` : (nameById.get(id) ?? '?'));

	const nodes = w.tasks.map(t => {
		const node: Record<string, unknown> = {};
		if (full) node.id = t.id;
		node.name = t.name;
		node.action = t.action?.ref ?? t.actionId;
		if (t.input && Object.keys(t.input as object).length > 0) node.input = t.input;
		// Surface per-task integration overrides so an edit visibly preserves them
		// (the tool resends them untouched; they are not edited through operations).
		if (t.packOverrides && t.packOverrides.length > 0) {
			node.packOverrides = t.packOverrides.map(packOverrideToInput);
		}
		if (t.publishResultAs) node.publishResultAs = t.publishResultAs;
		if (t.with && (t.with.items || t.with.concurrency)) node.with = t.with;
		if (full) {
			const position = positionOf(t);
			if (position) node.position = position;
		}
		return node;
	});

	const edges: Record<string, unknown>[] = [];
	for (const t of w.tasks) {
		for (const transition of t.next ?? []) {
			const targets = (transition.do ?? []).map(targetRef);
			const publish = normalizePublish(transition.publish);
			const edge: Record<string, unknown> = {
				from: t.name,
				when: transition.when ?? '{{ SUCCEEDED }}',
				to: targets,
			};
			if (transition.label) edge.label = transition.label;
			if (publish.length > 0) edge.publish = publish;
			if (full && transition.id) edge.transitionId = transition.id;
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

	const workflow: Record<string, unknown> = {
		id: w.id,
		name: w.name,
		description: w.description ?? undefined,
		orgId: w.orgId,
		orgName: w.organization?.name ?? undefined,
		type: w.type ?? undefined,
		inputs,
	};
	// Outputs are the caller-visible return contract ([{name: "<jinja>"}] on the
	// API); shown as name/value pairs so a caller knows what RESULT.<name> holds.
	const outputEntries = normalizePublish(Array.isArray(w.output) ? w.output : []);
	if (outputEntries.length > 0) {
		workflow.outputs = outputEntries.map(entry => ({ name: entry.key, value: entry.value }));
	}
	if (full) workflow.versionToken = w.updatedAt;

	const note = full
		? 'To edit or auto-layout, pass these workflow fields straight through: workflowId=workflow.id, workflowName=workflow.name, orgId=workflow.orgId, orgName=workflow.orgName (use the names, not the ids). The version token is handled for you. node.position is the canvas {x,y} top-left anchor in free pixels (x right, y down); new tasks are auto-placed below the action they connect from unless you pass x/y. To call another workflow, use add_task with subWorkflowId set to that workflow id (there is no run-workflow action). Branch on a task\'s output with RESULT.<field> in that task\'s transitions, or CTX.<publishResultAs>.<field> — not CTX.<field>. "workflow.inputs" are the run/call parameters; change them with the set_inputs operation (do not hand-edit varsSchema). "workflow.outputs" are the return contract a caller reads from this workflow as RESULT.<name>; change them with the set_output operation. When troubleshooting a condition or expression, render it against a recent execution with buddy_render_jinja before editing — confirm it evaluates as you expect (types matter: a boolean is not the string "true").'
		: 'Analysis view: task ids, transition ids, canvas positions, and the version token are omitted, and tasks/edges are referenced by NAME — which is exactly what buddy_workflow_edit operations use, so you can edit straight from this view. Call buddy_workflow_get again with detail:"full" only to reposition a task or target one specific transition by its id. To edit or run, pass workflowId=workflow.id, workflowName=workflow.name, orgId=workflow.orgId, orgName=workflow.orgName. To call another workflow, use add_task with subWorkflowId set to that workflow id (there is no run-workflow action). Branch on a task\'s output with RESULT.<field> in that task\'s transitions, or CTX.<publishResultAs>.<field> — not CTX.<field>. "workflow.inputs" are the run/call parameters; change them with the set_inputs operation (do not hand-edit varsSchema). "workflow.outputs" are the return contract a caller reads from this workflow as RESULT.<name>; change them with the set_output operation. Before changing a condition or expression, confirm it with buddy_render_jinja against a recent execution (types matter: a boolean is not the string "true").';

	return formatWorkflowOutput(JSON.stringify({ workflow, nodes, edges, note }, null, 1));
}

// ---------------------------------------------------------------------------
// Tool runners
// ---------------------------------------------------------------------------

// Availability is gated by the MCP capability settings before runToolRequests
// routes here. The remaining requirement is a live session to run GraphQL
// against.
function requireDeps(deps: GraphqlToolDeps | undefined): GraphqlToolDeps {
	if (!deps) {
		throw new Error('No active Rewst session for the workflow tools. Sign in to Rewst in VS Code and retry.');
	}
	return deps;
}

async function runWorkflowGet(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const workflowId = asStringArg(request.args, 'workflowId');
	const orgId = asStringArg(request.args, 'orgId');
	if (!workflowId || !orgId) throw new Error('buddy_workflow_get requires "workflowId" and "orgId".');
	const detail = asStringArg(request.args, 'detail') === 'full' ? 'full' : 'summary';
	return summarizeWorkflow(await fetchWorkflow(deps, workflowId, orgId), detail);
}

async function runActionSearch(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const orgId = asStringArg(request.args, 'orgId');
	if (!orgId) throw new Error('buddy_action_search requires "orgId".');
	const ref = asStringArg(request.args, 'ref');
	const actionId = asStringArg(request.args, 'actionId');

	if (ref || actionId) {
		const search = ref ? { ref: { _eq: ref } } : { id: { _eq: actionId } };
		const result = await deps.execute(ACTION_DESCRIBE_QUERY, { orgId, search });
		const row = (result.data as { actionsForOrg?: Record<string, unknown>[] } | undefined)?.actionsForOrg?.[0];
		if (!row) throw new Error(`Action ${ref ?? actionId} not found in org ${orgId}.`);
		return formatWorkflowOutput(JSON.stringify(row, null, 1));
	}

	const query = asStringArg(request.args, 'query');
	if (!query) throw new Error('buddy_action_search requires "query" (search) or "ref"/"actionId" (describe).');
	// Calling another workflow isn't an action — steer away from the dead-end search.
	if (/\b(sub.?workflow|run.?workflow|call.?workflow|execute.?workflow)\b/i.test(query)) {
		return "Calling another workflow is not an action — there is no run-workflow action. To call a workflow as a sub-workflow, add a task with buddy_workflow_edit add_task and set subWorkflowId to the target workflow's id (a workflow's id is its action id). Find the target workflow id with your workflow-search tool.";
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
	return formatWorkflowOutput(
		`Actions matching "${query}":\n${lines.join('\n')}\n\nDescribe one with buddy_action_search {"orgId","ref"} to see its input parameters.`,
	);
}

async function runRenderJinja(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const orgId = asStringArg(request.args, 'orgId');
	const template = asStringArg(request.args, 'template');
	const keysMode = request.args.keys === true;
	if (!orgId) throw new Error('buddy_render_jinja requires "orgId".');
	if (!keysMode && !template) {
		throw new Error('buddy_render_jinja requires "template" (or pass keys:true to list the context keys).');
	}

	// Resolve the render context (CTX). An executionId is fetched server-side so the
	// (large) run context never enters the chat; vars is an inline alternative.
	let vars = request.args.vars && typeof request.args.vars === 'object' ? (request.args.vars as object) : undefined;
	let contextNote = '';
	const executionId = asStringArg(request.args, 'executionId');
	if (executionId) {
		const result = await deps.execute(EXECUTION_CONTEXTS_QUERY, { id: executionId });
		const error = firstErrorMessage(result);
		if (error) throw new Error(`Failed to read execution context: ${error}`);
		const raw = (result.data as { workflowExecutionContexts?: unknown } | undefined)?.workflowExecutionContexts;
		const snapshots = Array.isArray(raw) ? raw : raw ? [raw] : [];
		if (snapshots.length === 0) throw new Error(`Execution ${executionId} has no context to render against.`);
		if (typeof request.args.contextIndex === 'number') {
			const index = Math.max(0, Math.min(snapshots.length - 1, request.args.contextIndex));
			vars = snapshots[index] as object;
			contextNote = ` (snapshot ${index} of ${snapshots.length}, unmerged)`;
		} else {
			// The stored snapshots are per-publish DELTAS, not cumulative states —
			// the last one holds only the keys of the run's final publish. Merge
			// them in order so the default context is the closest view of the
			// run's final CTX (later writes to a key win).
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
		return formatWorkflowOutput(
			`Context top-level keys (${keys.length}): ${keys.join(', ') || '(none)'}${contextNote}\n\nDrill in with {{ CTX.<key> }}. System vars: execution id = CTX.execution_id, org id = CTX.organization.id, this workflow's id = CTX.trigger_instance.trigger.workflow_id.`,
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
	return formatWorkflowOutput(`Rendered: ${JSON.stringify(value)} (type ${value === null ? 'null' : typeof value})`);
}

/** Validates the four scope fields a workflow mutation must carry. */
function requireScopeFields(toolName: string, args: Record<string, unknown>): { workflowId: string; orgId: string } {
	const missing = MUTATION_SCOPE_KEYS.filter(key => !asStringArg(args, key));
	if (missing.length > 0) {
		throw new Error(
			`${toolName} requires non-empty ${MUTATION_SCOPE_KEYS.join(', ')} (get them from buddy_workflow_get). Missing: ${missing.join(', ')}.`,
		);
	}
	return { workflowId: asStringArg(args, 'workflowId')!, orgId: asStringArg(args, 'orgId')! };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One-directional deep match: everything we sent must be present deep-equal in
 * what the server stored; extra stored keys (server defaults) are fine. One
 * deliberate looseness: two non-object values with the same textual value
 * (1 vs "1") match, because the server round-trips scalars through its own
 * typing and that is not data loss.
 */
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
 * prefixed with the dotted path. The Rewst API filters a task's input against
 * the action's inputSchema and reports success anyway — dropped keys and
 * coerced values are only visible by re-reading and comparing.
 */
export function sentValueDivergences(sent: unknown, stored: unknown, path: string): string[] {
	if (isPlainObject(sent) && isPlainObject(stored)) {
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
	return storedValueMatches(sent, stored) ? [] : [`${path}: sent ${briefValue(sent)}, stored ${briefValue(stored)}`];
}

/**
 * The tasks whose stored input/with are worth verifying after a save: those an
 * operation in this batch supplied an input or with for. Graph-only edits
 * (connect, reposition, autolayout…) verify nothing, so they stay one read.
 */
function tasksToVerify(operations: WorkflowOperation[], sentTasks: RawTask[]): RawTask[] {
	const byId = new Map<string, RawTask>();
	for (const operation of operations) {
		let provided: Record<string, unknown> | undefined;
		let ref: string | undefined;
		if (operation.op === 'add_task') {
			provided = operation;
			ref = str(operation.name);
		} else if (operation.op === 'update_task') {
			provided = asObject(operation.set);
			ref = str(operation.id) ?? str(operation.name);
		}
		if (!provided || !ref || (provided.input == null && provided.with == null)) continue;
		try {
			const task = resolveTask(sentTasks, ref);
			byId.set(task.id, task);
		} catch {
			// Renamed by a later operation in the batch or deleted again; skip.
		}
	}
	return [...byId.values()];
}

/**
 * Best-effort post-save check: re-read the workflow and compare each verified
 * task's stored input/with against what was sent. Returns a suffix for the
 * tool result — a WARNING listing divergences, a note when the verification
 * read failed, or an empty string when everything matches.
 */
async function verifySavedTaskValues(
	deps: GraphqlToolDeps,
	workflowId: string,
	orgId: string,
	toVerify: RawTask[],
): Promise<string> {
	try {
		const saved = await fetchWorkflow(deps, workflowId, orgId);
		const storedById = new Map(saved.tasks.map(t => [t.id, t]));
		const problems: string[] = [];
		for (const sent of toVerify) {
			const stored = storedById.get(sent.id);
			if (!stored) {
				problems.push(`- task "${sent.name}": not present in the saved workflow`);
				continue;
			}
			const lines = [
				...sentValueDivergences(sent.input ?? {}, stored.input ?? {}, 'input'),
				...(sent.with != null ? sentValueDivergences(sent.with, stored.with ?? {}, 'with') : []),
			];
			problems.push(...lines.map(line => `- task "${sent.name}": ${line}`));
		}
		if (problems.length === 0) return '';
		return (
			`\n\nWARNING — the server did not store some task values as sent. Rewst filters a task's input against its action's inputSchema: unknown keys are dropped and mistyped values coerced (a string in an object-typed field becomes {}), while the save still reports success.\n` +
			`${problems.join('\n')}\n` +
			`Check the action's accepted parameters with buddy_action_search describe mode, then re-apply with matching keys and types.`
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `\n\nNote: the edit saved, but the tool could not verify the stored task inputs (${message}); re-read with buddy_workflow_get to confirm.`;
	}
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
	// Final gate before writing. In production this is already true (the user
	// approved at prepareInvocation), but a direct/fallback caller can decline.
	if (!(await deps.confirmMutation(`update workflow "${workflow.name}" (${applied.length} operation(s))`))) {
		throw new Error('Workflow change was not confirmed.');
	}
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
	// The server can accept the save yet silently drop or coerce task input
	// keys (schema filtering). Re-read and compare what this batch sent, so a
	// "success" that lost data comes back as an explicit warning instead.
	const toVerify = tasksToVerify(operations, tasks);
	const verification = toVerify.length > 0 ? await verifySavedTaskValues(deps, workflowId, orgId, toVerify) : '';
	return `Applied ${applied.length} operation(s) to "${workflow.name}":\n${applied.map(line => `- ${line}`).join('\n')}\n\nSaved. New version token: ${updated?.updatedAt ?? '(unknown)'}.${verification}`;
}

async function runWorkflowEdit(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const { workflowId, orgId } = requireScopeFields('buddy_workflow_edit', request.args);
	const operations = request.args.operations;
	if (!Array.isArray(operations) || operations.length === 0) {
		throw new Error('buddy_workflow_edit requires a non-empty "operations" array.');
	}
	const comment = asStringArg(request.args, 'comment') ?? 'Edited by Cage-Free Rewsty';
	return applyWorkflowMutation(deps, workflowId, orgId, operations as WorkflowOperation[], comment);
}

async function runWorkflowAutolayout(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const { workflowId, orgId } = requireScopeFields(WORKFLOW_AUTOLAYOUT_TOOL_NAME, request.args);
	const comment = asStringArg(request.args, 'comment') ?? 'Auto-laid out by Cage-Free Rewsty';
	return applyWorkflowMutation(deps, workflowId, orgId, [{ op: 'autolayout' }], comment);
}

// ---------------------------------------------------------------------------
// Task logs: per-task status/input/result for one execution. The fastest way to
// see WHY a run failed without the agent hand-writing taskLogs GraphQL (and
// rediscovering that the field is originalWorkflowTaskName, the arg is order
// not orderBy, etc.). Shared by buddy_execution_logs and run-and-wait.
// ---------------------------------------------------------------------------

interface TaskLogRow {
	id?: string | null;
	originalWorkflowTaskName?: string | null;
	status?: string | null;
	message?: string | null;
	input?: unknown;
	result?: unknown;
	createdAt?: string | null;
}

const TASK_VALUE_CHARS = 600;

/** A failed/errored status, for both task and execution status strings. */
function isFailedStatus(status: string | null | undefined): boolean {
	return /fail|error/i.test(status ?? '');
}

function briefValue(value: unknown): string {
	if (value === undefined || value === null) return '(none)';
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (!text) return '(none)';
	return text.length > TASK_VALUE_CHARS ? text.slice(0, TASK_VALUE_CHARS) + '…(truncated)' : text;
}

async function fetchTaskLogs(deps: GraphqlToolDeps, executionId: string): Promise<TaskLogRow[]> {
	const result = await deps.execute(TASK_LOGS_QUERY, { where: { workflowExecutionId: executionId } });
	const error = firstErrorMessage(result);
	if (error) throw new Error(`Failed to read task logs: ${error}`);
	return ((result.data as { taskLogs?: (TaskLogRow | null)[] } | undefined)?.taskLogs ?? []).filter(
		(r): r is TaskLogRow => !!r,
	);
}

function formatTaskLogs(rows: TaskLogRow[], opts: { failedOnly?: boolean; includeResult?: boolean }): string {
	const visible = opts.failedOnly ? rows.filter(r => isFailedStatus(r.status)) : rows;
	if (visible.length === 0) {
		return opts.failedOnly ? 'No failed tasks in this execution.' : 'This execution has no task logs yet.';
	}
	return visible
		.map(row => {
			const name = row.originalWorkflowTaskName ?? '(unnamed task)';
			const failed = isFailedStatus(row.status);
			const parts = [`- ${name}: ${row.status ?? '?'}`];
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

async function runExecutionLogs(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const executionId = asStringArg(request.args, 'executionId');
	if (!executionId) throw new Error('buddy_execution_logs requires "executionId".');
	const failedOnly = request.args.failedOnly === true;
	const includeResult = request.args.includeResult === true;
	const rows = await fetchTaskLogs(deps, executionId);
	const failed = rows.filter(r => isFailedStatus(r.status)).length;
	const header = `Execution ${executionId}: ${rows.length} task(s), ${failed} failed.`;
	return formatWorkflowOutput(`${header}\n${formatTaskLogs(rows, { failedOnly, includeResult })}`);
}

// ---------------------------------------------------------------------------
// Run-and-wait: trigger a run and, by default, poll to a terminal state so the
// outcome (and on failure the failing task's log) comes back in one tool call
// instead of a run -> poll -> poll -> logs sequence.
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
		// Surface auth/schema/lookup failures immediately rather than looping to the
		// timeout and reporting a misleading "still running".
		const error = firstErrorMessage(result);
		if (error) throw new Error(`Failed to poll execution ${executionId}: ${error}`);
		const status =
			(result.data as { workflowExecutions?: (ExecutionRow | null)[] } | undefined)?.workflowExecutions?.[0]
				?.status ?? undefined;
		if (isTerminalExecutionStatus(status)) return { status, timedOut: false };
		if (Date.now() >= deadline) return { status, timedOut: true };
		await delay(RUN_POLL_INTERVAL_MS);
	}
}

async function runWorkflowRun(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const { workflowId, orgId } = requireScopeFields(WORKFLOW_RUN_TOOL_NAME, request.args);
	const input = request.args.input && typeof request.args.input === 'object' ? request.args.input : undefined;
	const result = await deps.execute(TEST_WORKFLOW_MUTATION, { id: workflowId, orgId, input });
	const error = firstErrorMessage(result);
	if (error) throw new Error(`testWorkflow failed: ${error}`);
	const executionId = (result.data as { testWorkflow?: { executionId?: string } } | undefined)?.testWorkflow
		?.executionId;
	if (!executionId) throw new Error('testWorkflow returned no execution id.');
	const name = asStringArg(request.args, 'workflowName');

	if (request.args.wait === false) {
		return `Started a run of "${name}". executionId: ${executionId}\n\nWatch it with buddy_execution_logs {"executionId": "${executionId}"}, or inspect context with buddy_render_jinja {"executionId": "${executionId}", "template": "{{ CTX.<field> }}"}.`;
	}

	const { status, timedOut } = await pollExecutionStatus(deps, executionId);
	if (timedOut) {
		return `Started a run of "${name}". executionId: ${executionId}\nStill ${status ?? 'running'} after ${Math.round(RUN_MAX_WAIT_MS / 1000)}s — check back with buddy_execution_logs {"executionId": "${executionId}"}.`;
	}
	const head = `Run of "${name}" finished: ${(status ?? 'unknown').toUpperCase()}. executionId: ${executionId}`;
	if (isFailedStatus(status)) {
		const rows = await fetchTaskLogs(deps, executionId);
		return formatWorkflowOutput(
			`${head}\n\nFailing task(s):\n${formatTaskLogs(rows, { failedOnly: true })}\n\nFull logs: buddy_execution_logs {"executionId": "${executionId}"}.`,
		);
	}
	return `${head}\n\nInspect what it produced with buddy_execution_logs {"executionId": "${executionId}", "includeResult": true} or buddy_render_jinja {"executionId": "${executionId}", "template": "{{ CTX.<field> }}"}.`;
}

interface ExecutionRow {
	id?: string | null;
	status?: string | null;
	createdAt?: string | null;
	numSuccessfulTasks?: number | null;
	orgId?: string | null;
	originatingExecutionId?: string | null;
	parentExecutionId?: string | null;
}

async function runWorkflowExecutions(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const workflowId = asStringArg(request.args, 'workflowId');
	const orgId = asStringArg(request.args, 'orgId');
	if (!workflowId || !orgId) throw new Error('buddy_workflow_executions requires "workflowId" and "orgId".');
	const status = asStringArg(request.args, 'status');
	const limit = typeof request.args.limit === 'number' ? Math.max(1, Math.min(50, request.args.limit)) : 10;
	const rootOnly = asBooleanArg(request.args, 'rootOnly') ?? true;
	const where = { workflowId, ...(rootOnly ? { orgId } : {}), ...(status ? { status } : {}) };
	const result = await deps.execute(WORKFLOW_EXECUTIONS_QUERY, { where, order: [['createdAt', 'desc']], limit });
	const error = firstErrorMessage(result);
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
	return formatWorkflowOutput(
		`${rows.length} ${status ?? 'recent'} execution(s), newest first:\n${rows.map(fmt).join('\n')}\n\nInspect one with buddy_render_jinja {"executionId": "<id>", "template": "{{ CTX.<field> }}"}.`,
	);
}

// ---------------------------------------------------------------------------
// Workflow search: a session-lived index of every workflow (id, name, org) the
// session can reach, so the assistant resolves a workflow by name in ONE call
// instead of guessing ids or paging GraphQL. Built lazily on the first search
// (never at startup) and reused until refreshed.
// ---------------------------------------------------------------------------

interface WorkflowIndexEntry {
	id: string;
	name: string;
	orgId: string;
	orgName: string;
}

interface WorkflowIndex {
	entries: WorkflowIndexEntry[];
	orgCount: number;
	builtAt: number;
	truncated: boolean;
}

const WORKFLOW_INDEX_CACHE_LIMIT = 8;
const workflowIndexCache = new Map<string, WorkflowIndex>();

/** Test seam: drop the cached index so a build runs fresh. */
export function _resetWorkflowIndexForTesting(): void {
	workflowIndexCache.clear();
}

const WORKFLOW_INDEX_PAGE_SIZE = 2000;
const WORKFLOW_INDEX_MAX_PAGES = 25; // safety bound (~50k workflows) against a runaway loop

interface RawIndexWorkflow {
	id?: string | null;
	name?: string | null;
	orgId?: string | null;
	organization?: { id?: string | null; name?: string | null } | null;
}

async function buildWorkflowIndex(deps: GraphqlToolDeps): Promise<WorkflowIndex> {
	const entries: WorkflowIndexEntry[] = [];
	const orgIds = new Set<string>();
	let truncated = false;
	for (let page = 0; page < WORKFLOW_INDEX_MAX_PAGES; page++) {
		const result = await deps.execute(WORKFLOWS_INDEX_QUERY, {
			limit: WORKFLOW_INDEX_PAGE_SIZE,
			offset: page * WORKFLOW_INDEX_PAGE_SIZE,
		});
		const error = firstErrorMessage(result);
		if (error) {
			if (page === 0) throw new Error(`Failed to list workflows: ${error}`);
			break; // a later page failing must not discard the workflows already gathered
		}
		const rows = (result.data as { workflows?: (RawIndexWorkflow | null)[] } | undefined)?.workflows ?? [];
		for (const w of rows) {
			if (!w?.id) continue;
			const orgId = w.orgId ?? w.organization?.id ?? '';
			orgIds.add(orgId);
			entries.push({
				id: w.id,
				name: w.name ?? '(unnamed)',
				orgId,
				orgName: w.organization?.name ?? orgId ?? '(unknown org)',
			});
		}
		if (rows.length < WORKFLOW_INDEX_PAGE_SIZE) break;
		if (page === WORKFLOW_INDEX_MAX_PAGES - 1) truncated = true;
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return { entries, orgCount: orgIds.size, builtAt: Date.now(), truncated };
}

function ageString(ms: number): string {
	const seconds = Math.round((Date.now() - ms) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	return `${Math.round(minutes / 60)}h ago`;
}

/** Lowercase and collapse every run of non-alphanumerics to a single space, so
 * matching ignores punctuation/spacing: "Jon's Sandbox", "[RAVEN] Workflow Lock"
 * → "jon s sandbox", "raven workflow lock". A query's tokens are then matched as
 * substrings in any order, so "jon sandbox" finds "Jon's Sandbox" and "lock
 * workflow" finds "[RAVEN] Workflow Lock". */
function normalizeText(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

interface NameHit {
	entry: WorkflowIndexEntry;
	rank: number;
}

// The index spans every org reachable from the session, so query/orgId/limit only
// filter its entries at read time — they must NOT be part of the cache key. Keying
// on the session scope alone means one build serves all searches (no re-list per
// distinct query) and a refresh rebuilds the single shared index for everyone
// (so a later query can't return a stale index that omits a new workflow).
function workflowSearchCacheKey(request: ToolRequest, deps: GraphqlToolDeps): string {
	const payload = stableJson({ scope: deps.cacheScope ?? null, tool: request.tool });
	return createHash('sha256').update(payload).digest('hex');
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => a.localeCompare(b));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function getCachedWorkflowIndex(cacheKey: string): WorkflowIndex | undefined {
	const index = workflowIndexCache.get(cacheKey);
	if (!index) return undefined;
	workflowIndexCache.delete(cacheKey);
	workflowIndexCache.set(cacheKey, index);
	return index;
}

function setCachedWorkflowIndex(cacheKey: string, index: WorkflowIndex): void {
	workflowIndexCache.delete(cacheKey);
	workflowIndexCache.set(cacheKey, index);
	while (workflowIndexCache.size > WORKFLOW_INDEX_CACHE_LIMIT) {
		const oldest = workflowIndexCache.keys().next().value;
		if (oldest === undefined) break;
		workflowIndexCache.delete(oldest);
	}
}

async function runWorkflowSearch(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const refresh = request.args.refresh === true;
	const cacheKey = workflowSearchCacheKey(request, deps);
	let index = getCachedWorkflowIndex(cacheKey);
	if (refresh || !index) {
		index = await buildWorkflowIndex(deps);
		setCachedWorkflowIndex(cacheKey, index);
	}

	const rawQuery = (asStringArg(request.args, 'query') ?? '').trim();
	const qLower = rawQuery.toLowerCase();
	const qNorm = normalizeText(rawQuery);
	const qTokens = qNorm.split(' ').filter(Boolean);
	const orgId = asStringArg(request.args, 'orgId');
	const limit = typeof request.args.limit === 'number' ? Math.max(1, Math.min(200, request.args.limit)) : 25;

	const pool = orgId ? index.entries.filter(entry => entry.orgId === orgId) : index.entries;

	// Split hits into name/id matches (the answer) and org-only matches (a query
	// that matched an ORG name, e.g. "jon's sandbox" → every workflow in that org).
	// Org-only matches are summarized, never listed, so they cannot flood a search.
	const nameHits: NameHit[] = [];
	const orgOnly: WorkflowIndexEntry[] = [];
	for (const entry of pool) {
		if (!rawQuery) {
			nameHits.push({ entry, rank: 2 });
			continue;
		}
		const nameNorm = normalizeText(entry.name);
		const nameMatch = qTokens.every(token => nameNorm.includes(token));
		const idMatch = qLower.length >= 3 && entry.id.toLowerCase().includes(qLower);
		if (nameMatch || idMatch) {
			nameHits.push({ entry, rank: nameMatch ? nameRank(nameNorm, qNorm) : 3 });
		} else if (qTokens.length > 0 && qTokens.every(token => normalizeText(entry.orgName).includes(token))) {
			orgOnly.push(entry);
		}
	}
	nameHits.sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name));

	const total = nameHits.length + orgOnly.length;
	const header =
		`${total} workflow(s)${rawQuery ? ` matching "${rawQuery}"` : ''}` +
		` (index: ${index.entries.length} workflows across ${index.orgCount} org(s)${index.truncated ? ', truncated at the page cap' : ''}, built ${ageString(index.builtAt)}; refresh:true to rebuild).`;
	if (total === 0) {
		return `${header}\nNo matches. Try fewer/looser words, drop orgId, or refresh:true if the workflow is new.`;
	}

	const parts = [header];
	const shown = nameHits.slice(0, limit);
	if (shown.length > 0) {
		if (rawQuery) parts.push('Matched by name:');
		parts.push(
			shown
				.map(h => `- ${h.entry.name}  (id: ${h.entry.id})  org: ${h.entry.orgName} (${h.entry.orgId})`)
				.join('\n'),
		);
		if (nameHits.length > shown.length) {
			parts.push(`…and ${nameHits.length - shown.length} more by name; raise limit or narrow the query.`);
		}
	} else if (rawQuery) {
		parts.push('No workflows matched by name.');
	}
	if (orgOnly.length > 0) {
		const byOrg = new Map<string, { name: string; count: number }>();
		for (const entry of orgOnly) {
			const cur = byOrg.get(entry.orgId) ?? { name: entry.orgName, count: 0 };
			cur.count++;
			byOrg.set(entry.orgId, cur);
		}
		const summary = [...byOrg.entries()].map(([id, v]) => `${v.name} (${v.count}; orgId ${id})`).join(', ');
		parts.push(
			`Plus ${orgOnly.length} workflow(s) in matching org(s), not by name: ${summary}. Pass that orgId to list an org's workflows.`,
		);
	}
	return formatWorkflowOutput(parts.join('\n'));
}

/** Lower is better: 0 exact name, 1 name starts-with the query, 2 all tokens present. */
function nameRank(nameNorm: string, qNorm: string): number {
	if (!qNorm) return 2;
	if (nameNorm === qNorm) return 0;
	if (nameNorm.startsWith(qNorm)) return 1;
	return 2;
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
		case WORKFLOW_EDIT_TOOL_NAME:
			return runWorkflowEdit(request, bound);
		case WORKFLOW_AUTOLAYOUT_TOOL_NAME:
			return runWorkflowAutolayout(request, bound);
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

// ---------------------------------------------------------------------------
// Mutation approval integration (mirrors graphqlTool's scope machinery)
// ---------------------------------------------------------------------------

/** Tool names that act on a workflow and share the per-workflow approval scope. */
const WORKFLOW_MUTATION_TOOLS = new Set<string>([
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
]);

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
	const from = str(operation.from);
	const to = str(operation.to);
	const detail = str(operation.name) ?? (from && to ? `${from}->${to}` : from) ?? str(operation.id);
	return detail ? `${op} ${detail}` : String(op);
}

/**
 * The inline approval prompt for a buddy_workflow_edit request, or undefined
 * when no prompt is needed (not an edit, already approved this session, or
 * missing scope fields — refused downstream). Summarizes the operations so the
 * user sees what will change before approving.
 */
export function workflowEditConfirmation(name: string, input: unknown): GraphqlMutationConfirmation | undefined {
	const scope = workflowEditScope(name, input);
	if (!scope) return undefined;
	const alwaysPrompt = workflowToolAlwaysPrompts(name);
	if (!alwaysPrompt && isMutationScopeApproved(scope)) return undefined;
	const args = asObject(input);
	const approvalMemory = alwaysPrompt
		? ''
		: ' Approving also lets further actions on this same workflow run for the rest of this session without asking again.';
	const lead = `workflow **${scope.scopeName}** (\`${scope.scopeId}\`) in org **${scope.orgName}** (\`${scope.orgId}\`)?${approvalMemory}`;
	let lines: string[];
	let title = 'Cage-Free Rewsty wants to edit a Rewst workflow';
	if (name === WORKFLOW_AUTOLAYOUT_TOOL_NAME) {
		lines = [`Auto-layout ${lead}`, '', 'This re-arranges every task position on the canvas.'];
	} else if (name === WORKFLOW_RUN_TOOL_NAME) {
		title = 'Cage-Free Rewsty wants to run a Rewst workflow';
		const runInput = asObject(args.input);
		lines = [`Run ${lead}`, '', 'This executes the workflow.'];
		if (Object.keys(runInput).length > 0)
			lines.push('', 'Input:', `\`\`\`json\n${JSON.stringify(runInput, null, 2)}\n\`\`\``);
	} else {
		lines = [
			`Edit ${lead}`,
			'',
			'Operations:',
			...(Array.isArray(args.operations) ? (args.operations as WorkflowOperation[]) : []).map(
				operation => `- ${describeOperation(operation)}`,
			),
		];
	}
	return { title, message: lines.join('\n') };
}
