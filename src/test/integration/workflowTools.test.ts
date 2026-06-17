import * as assert from 'assert';
import * as Mocha from 'mocha';
import { getTestSession, getTestToken, hasTestToken, initTestEnvironment } from '@test';
import { runWorkflowTool } from '../../ui/chat/tools/workflowTools';
import type { GraphqlToolDeps } from '../../ui/chat/tools/graphqlTool';

const { suite, test, suiteSetup } = Mocha;

// Defaults to the sandbox "Learning Workflow"; override per environment.
const WORKFLOW_ID = process.env.REWST_TEST_WORKFLOW_ID ?? '019ecc4c-b826-70b0-a8c7-e87ff2377833';
const ORG_ID = process.env.REWST_TEST_WORKFLOW_ORG_ID ?? '01940973-8a88-7109-8ba7-d64bfbb18950';

interface GraphSummary {
	workflow: { id: string; name: string; orgId: string; orgName?: string };
	nodes: { id: string; name: string; action: string }[];
	edges: { from: string; to: string[]; label?: string }[];
}

suite('Integration: workflowTools', function () {
	this.timeout(30000);

	let deps: GraphqlToolDeps;
	let available = false;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
		}
		initTestEnvironment();
		// The test session builds its SDK straight from the token without storing a
		// cookie in secrets, so session.rawGraphql can't read one. Run GraphQL with a
		// direct authenticated fetch to the session's region, as the tool ultimately does.
		const session = await getTestSession();
		const url = session.profile.region.graphqlUrl;
		const token = getTestToken();
		const cookie = token.includes('=') ? token : `appSession=${token}`;
		deps = {
			isEnabled: () => true,
			confirmMutation: async () => true,
			execute: async (query, variables) => {
				const res = await fetch(url, {
					method: 'POST',
					headers: { 'content-type': 'application/json', cookie },
					body: JSON.stringify({ query, variables }),
				});
				const body = (await res.json()) as { data?: unknown; errors?: unknown };
				return { data: body.data, errors: body.errors };
			},
		};
		// Confirm the configured workflow is reachable; otherwise skip the suite.
		try {
			const out = await runWorkflowTool(
				{ tool: 'rewst_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
				deps,
			);
			available = (JSON.parse(out) as GraphSummary).workflow.id === WORKFLOW_ID;
		} catch (error) {
			console.log('workflowTools integration: workflow unavailable —', error);
			available = false;
		}
		if (!available) this.skip();
	});

	test('rewst_workflow_get returns a normalized node/edge graph', async () => {
		const out = await runWorkflowTool(
			{ tool: 'rewst_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
			deps,
		);
		const summary = JSON.parse(out) as GraphSummary;
		assert.ok(summary.nodes.length > 0, 'has nodes');
		assert.ok(summary.edges.length > 0, 'has edges');
		assert.ok(
			summary.nodes.every(node => typeof node.action === 'string'),
			'each node carries an action ref',
		);
	});

	test('rewst_action_search finds core.noop and describes its parameters', async () => {
		const search = await runWorkflowTool(
			{ tool: 'rewst_action_search', args: { orgId: ORG_ID, query: 'noop' } },
			deps,
		);
		assert.match(search, /core\.noop/);

		const describe = await runWorkflowTool(
			{ tool: 'rewst_action_search', args: { orgId: ORG_ID, ref: 'core.noop' } },
			deps,
		);
		const action = JSON.parse(describe) as { ref: string; parameters: unknown };
		assert.strictEqual(action.ref, 'core.noop');
		assert.ok('parameters' in action, 'describe mode returns parameters');
	});

	test('rewst_render_jinja evaluates a template (against a recent execution if one exists)', async () => {
		// Plain arithmetic proves the renderer works regardless of context.
		const plain = await runWorkflowTool(
			{ tool: 'rewst_render_jinja', args: { orgId: ORG_ID, template: '{{ 1 + 1 }}', vars: {} } },
			deps,
		);
		assert.match(plain, /Rendered: 2/);

		// If the workflow has an execution, render its context server-side.
		const execs = (await deps.execute(
			'query ($where: WorkflowExecutionWhereInput) { workflowExecutions(where: $where, limit: 1) { id } }',
			{ where: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
		)) as { data?: { workflowExecutions?: ({ id?: string } | null)[] } };
		const executionId = execs.data?.workflowExecutions?.[0]?.id;
		if (executionId) {
			const out = await runWorkflowTool(
				{
					tool: 'rewst_render_jinja',
					args: { orgId: ORG_ID, executionId, template: '{{ CTX.execution_id }}' },
				},
				deps,
			);
			assert.match(out, /Rendered:/, 'rendered against the execution context without erroring');
		}
	});

	test('rewst_workflow_executions lists recent runs without error', async () => {
		const out = await runWorkflowTool(
			{ tool: 'rewst_workflow_executions', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID, limit: 3 } },
			deps,
		);
		// Either some executions or a clean "no executions" message — never an error.
		assert.ok(/execution\(s\)|No .* executions/.test(out), out);
	});

	test('rewst_workflow_get surfaces the org name for the approval args', async () => {
		const summary = JSON.parse(
			await runWorkflowTool(
				{ tool: 'rewst_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
				deps,
			),
		) as GraphSummary;
		assert.ok(summary.workflow.orgName && summary.workflow.orgName !== ORG_ID, 'orgName is a name, not the id');
	});

	test('rewst_workflow_edit round-trips a transition label (content-neutral)', async () => {
		const before = JSON.parse(
			await runWorkflowTool(
				{ tool: 'rewst_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
				deps,
			),
		) as GraphSummary;

		// Pick a node with exactly one outgoing edge so set_transition is unambiguous.
		const counts = new Map<string, number>();
		for (const edge of before.edges) counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
		const target = before.edges.find(edge => counts.get(edge.from) === 1);
		assert.ok(target, 'a node with a single outgoing edge exists');

		const originalLabel = target!.label ?? '';
		const probeLabel = `${originalLabel} (probe)`;
		const edit = (label: string) =>
			runWorkflowTool(
				{
					tool: 'rewst_workflow_edit',
					args: {
						workflowId: WORKFLOW_ID,
						workflowName: before.workflow.name,
						orgId: ORG_ID,
						orgName: before.workflow.orgName ?? ORG_ID,
						operations: [{ op: 'set_transition', from: target!.from, set: { label } }],
					},
				},
				deps,
			);

		try {
			assert.match(await edit(probeLabel), /Applied 1 operation/);
			const mid = JSON.parse(
				await runWorkflowTool(
					{ tool: 'rewst_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
					deps,
				),
			) as GraphSummary;
			const changed = mid.edges.find(edge => edge.from === target!.from);
			assert.strictEqual(changed?.label, probeLabel, 'label updated');
		} finally {
			// Restore the original label so the workflow is left as found.
			await edit(originalLabel);
		}
	});
});
