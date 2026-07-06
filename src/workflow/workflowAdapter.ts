/**
 * Thin adapter: action-search runner and buddy_workflow_get runner (the
 * summarizeWorkflow formatter). These live here rather than in graphMutations
 * because they are read-only handlers with no edit-engine dependency.
 *
 * Part of the D1 split — workflowTools.ts re-exports from here.
 */

import { type GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import { asStringArg, type ToolRequest } from '../ui/chat/tools/toolProtocol';
import { ACTIONS_SEARCH_QUERY, fetchWorkflow, packOverrideToInput } from './graphMutations';
import { positionOf } from './layout';
import { RESULT_SHAPE_STEERING } from './specs';
import { type ExecResult, firstErrorMessage, normalizePublish, type RawWorkflow } from './types';

// ---------------------------------------------------------------------------
// Action search
// ---------------------------------------------------------------------------

interface ActionRow {
	id?: string | null;
	ref?: string | null;
	name?: string | null;
	category?: string | null;
	description?: string | null;
	deprecated?: boolean | null;
}

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
	const error = firstErrorMessage(result as ExecResult);
	if (error) throw new Error(`Action search failed: ${error}`);
	return (result.data as { actionsForOrg?: ActionRow[] } | undefined)?.actionsForOrg ?? [];
}

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

export async function runActionSearch(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const orgId = asStringArg(request.args, 'orgId');
	if (!orgId) throw new Error('buddy_action_search requires "orgId".');
	const ref = asStringArg(request.args, 'ref');
	const actionId = asStringArg(request.args, 'actionId');

	if (ref || actionId) {
		const search = ref ? { ref: { _eq: ref } } : { id: { _eq: actionId } };
		const result = await deps.execute(ACTION_DESCRIBE_QUERY, { orgId, search });
		const describeError = firstErrorMessage(result as ExecResult);
		if (describeError) throw new Error(`Action describe failed: ${describeError}`);
		const row = (result.data as { actionsForOrg?: Record<string, unknown>[] } | undefined)?.actionsForOrg?.[0];
		if (!row) throw new Error(`Action ${ref ?? actionId} not found in org ${orgId}.`);
		return JSON.stringify(row, null, 1);
	}

	const query = asStringArg(request.args, 'query');
	if (!query) throw new Error('buddy_action_search requires "query" (search) or "ref"/"actionId" (describe).');
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
	return `Actions matching "${query}":\n${lines.join('\n')}\n\nDescribe one with buddy_action_search {"orgId","ref"} to see its input parameters.`;
}

// ---------------------------------------------------------------------------
// buddy_workflow_get: summarize + runner
// ---------------------------------------------------------------------------

const MOCK_INPUT_SUMMARY_CHARS = 400;

export function summarizeWorkflow(w: RawWorkflow, detail: 'summary' | 'full' = 'summary'): string {
	const full = detail === 'full';
	const nameById = new Map(w.tasks.map(t => [t.id, t.name]));
	const targetRef = (id: string): string => (full ? `${nameById.get(id) ?? '?'} (${id})` : (nameById.get(id) ?? '?'));

	const nodes = w.tasks.map(t => {
		const node: Record<string, unknown> = {};
		if (full) node.id = t.id;
		node.name = t.name;
		node.action = t.action?.ref ?? t.actionId;
		if (t.input && Object.keys(t.input as object).length > 0) node.input = t.input;
		if (t.packOverrides && t.packOverrides.length > 0) {
			node.packOverrides = t.packOverrides.map(packOverrideToInput);
		}
		if (t.publishResultAs) node.publishResultAs = t.publishResultAs;
		if (t.with && (t.with.items || t.with.concurrency)) node.with = t.with;
		if (t.transitionMode && t.transitionMode !== 'FOLLOW_FIRST') node.transitionMode = t.transitionMode;
		if (t.join != null && t.join !== 1) node.join = t.join;
		if (t.runAsOrgId) node.runAsOrgId = t.runAsOrgId;
		if (t.isMocked === true) {
			node.isMocked = true;
			if (t.mockInput != null) {
				const json = JSON.stringify(t.mockInput);
				node.mockInput =
					full || json.length <= MOCK_INPUT_SUMMARY_CHARS
						? t.mockInput
						: `(mockInput ${json.length} chars — call buddy_workflow_get with detail:"full" to view)`;
			}
		}
		if (t.retry != null) node.retry = t.retry;
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
	const outputEntries = normalizePublish(Array.isArray(w.output) ? w.output : []);
	if (outputEntries.length > 0) {
		workflow.outputs = outputEntries.map(entry => ({ name: entry.key, value: entry.value }));
	}
	if (full) workflow.versionToken = w.updatedAt;

	const note = full
		? `To edit or auto-layout, pass these workflow fields straight through: workflowId=workflow.id, workflowName=workflow.name, orgId=workflow.orgId, orgName=workflow.orgName (use the names, not the ids). The version token is handled for you. node.position is the canvas {x,y} top-left anchor in free pixels (x right, y down); new tasks are auto-placed below the action they connect from unless you pass x/y. To call another workflow, use add_task with subWorkflowId set to that workflow id (there is no run-workflow action). ${RESULT_SHAPE_STEERING} "workflow.inputs" are the run/call parameters; change them with the set_inputs operation (do not hand-edit varsSchema). "workflow.outputs" are the return contract a caller reads from this workflow as RESULT.<output-key>; change them with the set_output operation. When troubleshooting a condition or expression, render it against a recent execution with buddy_render_jinja before editing — confirm it evaluates as you expect (types matter: a boolean is not the string "true").`
		: `Analysis view: task ids, transition ids, canvas positions, and the version token are omitted, and tasks/edges are referenced by NAME — which is exactly what buddy_workflow_edit operations use, so you can edit straight from this view. Call buddy_workflow_get again with detail:"full" only to reposition a task or target one specific transition by its id. To edit or run, pass workflowId=workflow.id, workflowName=workflow.name, orgId=workflow.orgId, orgName=workflow.orgName. To call another workflow, use add_task with subWorkflowId set to that workflow id (there is no run-workflow action). ${RESULT_SHAPE_STEERING} "workflow.inputs" are the run/call parameters; change them with the set_inputs operation (do not hand-edit varsSchema). "workflow.outputs" are the return contract a caller reads from this workflow as RESULT.<output-key>; change them with the set_output operation. Before changing a condition or expression, confirm it with buddy_render_jinja against a recent execution (types matter: a boolean is not the string "true").`;

	return JSON.stringify({ workflow, nodes, edges, note }, null, 1);
}

export async function runWorkflowGet(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const workflowId = asStringArg(request.args, 'workflowId');
	const orgId = asStringArg(request.args, 'orgId');
	if (!workflowId || !orgId) throw new Error('buddy_workflow_get requires "workflowId" and "orgId".');
	const detail = asStringArg(request.args, 'detail') === 'full' ? 'full' : 'summary';
	return summarizeWorkflow(await fetchWorkflow(deps, workflowId, orgId), detail);
}
