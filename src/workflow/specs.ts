/**
 * Tool-spec prose, inputSchema objects, and ToolSpec literals for all workflow
 * tools. Extracted from workflowTools.ts (D1 split) so the spec layer is
 * independent of the edit engine, layout, and execution modules.
 */

import { type ToolSpec, withGeneratedArgsForAll } from '../ui/chat/tools/toolProtocol';
import { workflowEditOperationGrammar } from './operationGrammar';

export const WORKFLOW_EDIT_TOOL_NAME = 'buddy_workflow_edit';
export const WORKFLOW_AUTOLAYOUT_TOOL_NAME = 'buddy_workflow_autolayout';
export const WORKFLOW_RUN_TOOL_NAME = 'buddy_workflow_run';
export const WORKFLOW_EXECUTION_LOGS_TOOL_NAME = 'buddy_execution_logs';
export const WORKFLOW_SEARCH_TOOL_NAME = 'buddy_workflow_search';

/**
 * Steering fragment: read summary first, escalate to full only when ids/positions are needed.
 * Appears verbatim in buddy_workflow_get description and in the MCP server instructions.
 */
export const WORKFLOW_SUMMARY_DETAIL_STEERING =
	'detail defaults to "summary": a concise ANALYSIS view that OMITS task ids, transition ids, canvas x/y positions, and the version token and refers to tasks/edges by name. Summary is sufficient for understanding, explaining, and most name-based edits (buddy_workflow_edit operations resolve tasks by name). Pass detail "full" only when you need task ids, transition ids, or canvas positions, such as repositioning a task or targeting one specific transition by id.';

/**
 * Steering fragment: prefer sub-workflow composition over one giant canvas.
 * Appears verbatim in buddy_workflow_edit description and in the MCP server instructions.
 */
export const WORKFLOW_COMPOSITION_STEERING =
	'PREFER COMPOSITION over one giant canvas: repeated sequences, independently testable sections, or many tasks doing one business operation are a sign to split; give the reusable sequence (ticket lifecycle, user lookup, license handling) its own workflow with set_inputs for its run inputs and set_output for its return values, then call it as a sub-workflow task.';

/**
 * Steering fragment: render-verify Jinja before and after edits.
 * Appears verbatim in buddy_render_jinja description and in the MCP server instructions.
 */
export const RENDER_VERIFY_STEERING =
	"Use this to CONFIRM a transition condition, task input, or publish expression evaluates the way you expect BEFORE editing a workflow — the agent otherwise guesses wrong (e.g. comparing a boolean to the string 'true', or reading a sub-workflow result from CTX.<field> instead of CTX.<publishResultAs>.<field>).";

/**
 * Running a workflow actually executes its automation, so it requires a fresh
 * approval every time and is never remembered per-session — unlike edit/autolayout.
 */
export function workflowToolAlwaysPrompts(name: string): boolean {
	return name === WORKFLOW_RUN_TOOL_NAME;
}

export const WORKFLOW_TOOL_SPECS: ToolSpec[] = withGeneratedArgsForAll([
	{
		name: 'buddy_workflow_get',
		description: `Read a Rewst workflow as a normalized graph: nodes (tasks with their action ref and input) and edges (transitions with their condition, label, target task names, and published context variables). Returns far less noise than raw GraphQL and the node/edge names this tool uses are exactly what buddy_workflow_edit operations expect. ${WORKFLOW_SUMMARY_DETAIL_STEERING}`,
		// NOTE: WORKFLOW_SUMMARY_DETAIL_STEERING is embedded verbatim above — do not paraphrase it here.
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
		description: `Edit a Rewst workflow by applying high-level operations. The tool reads the current workflow, applies the operations to the full graph, and saves it back with conflict detection and an undoable patch — you never resend the whole workflow or manage version tokens yourself. ${workflowEditOperationGrammar()}. Define workflow inputs ONLY with set_inputs: it writes the input name list, the action parameters that actually drive the run/call form, and the inputSchema together. Do not put inputs in varsSchema, which is a separate variables map. Loop inputs use with: {items, concurrency}; inside the loop body, {{ item() }} is the current element. At most one outgoing transition runs: the first condition that evaluates true in listed order. publish entries apply whenever that transition is taken, including on {{ FAILED }}. This tool does not expose parallel task controls. To call another workflow as a sub-workflow, set subWorkflowId (or action) to that workflow's id — a workflow's id is its action id; there is no separate run-workflow action. A caller reads that sub-workflow task result as RESULT.<name>, matching the callee's set_output contract. ${WORKFLOW_COMPOSITION_STEERING}`,
		// NOTE: WORKFLOW_COMPOSITION_STEERING is embedded verbatim above — do not paraphrase it here.
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
		description:
			"Inspect one workflow execution's task logs: per task, its status, and for failed tasks the message, the input it received, and the result it produced — the fastest way to see WHY a run failed, instead of hand-writing taskLogs GraphQL. Get an executionId from buddy_workflow_run or buddy_workflow_executions. By default every task shows name + status and failed tasks additionally show message, input, and result (truncated); pass includeResult to include every task's result, or failedOnly to list only failed tasks. A task that called a sub-workflow is marked with the sub-execution it spawned (workflow name, execution id, status) — a sub-workflow's own tasks are NOT in the parent's logs, so drill into a sub-execution by calling this tool again with its execution id, or pass includeSubExecutions:true to inline the task logs of the first few sub-executions. A task's input shows exactly what it received (an empty-string id means the caller passed nothing); its result shows the real output shape — read it before assuming a wrapper key (e.g. some actions return a list directly, not { items: [...] }). Each signed-in Rewst session only sees its own org hierarchy: if the first session has no rows for the execution, the other active sessions are checked automatically; pass orgId (the org that owns the execution) to query the right session directly.",
		inputSchema: {
			type: 'object',
			properties: {
				executionId: { type: 'string', description: 'The workflow execution id to inspect.' },
				orgId: {
					type: 'string',
					description:
						'Optional: the org that owns the execution — routes the lookup to the session managing that org (useful with several signed-in accounts).',
				},
				failedOnly: { type: 'boolean', description: 'List only failed tasks (default false).' },
				includeResult: {
					type: 'boolean',
					description: "Include every task's result, not just failed tasks' (default false).",
				},
				includeSubExecutions: {
					type: 'boolean',
					description:
						'Also inline the task logs of the first few sub-workflow executions this run spawned (default false).',
				},
			},
			required: ['executionId'],
		},
	},
	{
		name: 'buddy_render_jinja',
		description:
			`Render a Jinja template against a real workflow execution's context and return only the result. ${RENDER_VERIFY_STEERING}` +
			" Pass executionId and the tool fetches that run's context server-side, so the (large) context never enters the chat; or pass vars as an ad-hoc context object. This renders against the STORED context snapshot, which is the CTX namespace only — the live runtime objects WORKFLOW, ORG, USER, and RESULT do NOT exist here, so use their CTX equivalents: the execution id is CTX.execution_id, the org id is CTX.organization.id, and the running workflow's own id is CTX.trigger_instance.trigger.workflow_id. To discover what a run actually holds, pass keys:true to list the context's top-level keys instead of rendering (then drill in with {{ CTX.<key> }}). In the template, CTX is the context: read a field as {{ CTX.field }}, and to dump the whole context use {{ CTX() }} with parentheses — in a live Rewst workflow CTX is callable, so bare {{ CTX }} does not work. An execution's stored snapshots are per-publish deltas (each holds only the keys that publish wrote), so by default the tool merges them all, in order, into one cumulative context — the closest view of the run's final CTX; pass contextIndex to inspect one raw delta instead. Rewst context storage alphabetizes dict keys, so key order from dict.keys() may not match authoring order. For regex_replace backreferences, write '\\\\1' instead of a single-backslash capture group ref; an unexpected non-whitespace control character in the result usually means an escaping mistake. Returns the rendered value, or the Jinja error if it fails.",
		// NOTE: RENDER_VERIFY_STEERING is embedded verbatim in the description above — do not paraphrase it here.
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
]);

export const WORKFLOW_TOOL_NAMES = new Set(WORKFLOW_TOOL_SPECS.map(spec => spec.name));

export function isWorkflowTool(name: string): boolean {
	return WORKFLOW_TOOL_NAMES.has(name);
}
