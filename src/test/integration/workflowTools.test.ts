import * as assert from 'assert';
import * as Mocha from 'mocha';
import { log } from '@utils';
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
				{ tool: 'buddy_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
				deps,
			);
			available = (JSON.parse(out) as GraphSummary).workflow.id === WORKFLOW_ID;
		} catch (error) {
			log.debug('workflowTools integration: workflow unavailable —', error);
			available = false;
		}
		if (!available) this.skip();
	});

	test('buddy_workflow_get returns a normalized node/edge graph', async () => {
		const out = await runWorkflowTool(
			{ tool: 'buddy_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
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

	test('buddy_action_search finds core.noop and describes its parameters', async () => {
		const search = await runWorkflowTool(
			{ tool: 'buddy_action_search', args: { orgId: ORG_ID, query: 'noop' } },
			deps,
		);
		assert.match(search, /core\.noop/);

		const describe = await runWorkflowTool(
			{ tool: 'buddy_action_search', args: { orgId: ORG_ID, ref: 'core.noop' } },
			deps,
		);
		const action = JSON.parse(describe) as { ref: string; parameters: unknown };
		assert.strictEqual(action.ref, 'core.noop');
		assert.ok('parameters' in action, 'describe mode returns parameters');
	});

	test('buddy_render_jinja evaluates a template (against a recent execution if one exists)', async () => {
		// Plain arithmetic proves the renderer works regardless of context.
		const plain = await runWorkflowTool(
			{ tool: 'buddy_render_jinja', args: { orgId: ORG_ID, template: '{{ 1 + 1 }}', vars: {} } },
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
					tool: 'buddy_render_jinja',
					args: { orgId: ORG_ID, executionId, template: '{{ CTX.execution_id }}' },
				},
				deps,
			);
			assert.match(out, /Rendered:/, 'rendered against the execution context without erroring');
		}
	});

	test('buddy_workflow_executions lists recent runs without error', async () => {
		const out = await runWorkflowTool(
			{ tool: 'buddy_workflow_executions', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID, limit: 3 } },
			deps,
		);
		// Either some executions or a clean "no executions" message — never an error.
		assert.ok(/execution\(s\)|No .* executions/.test(out), out);
	});

	test("buddy_execution_logs reads a real execution's task logs (validates the taskLogs query)", async () => {
		// Find a recent execution to inspect; skip cleanly if the workflow has none.
		const execs = (await deps.execute(
			'query ($where: WorkflowExecutionWhereInput) { workflowExecutions(where: $where, limit: 1) { id } }',
			{ where: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
		)) as { data?: { workflowExecutions?: ({ id?: string } | null)[] } };
		const executionId = execs.data?.workflowExecutions?.[0]?.id;
		if (!executionId) {
			log.debug('buddy_execution_logs: no executions to inspect — skipping');
			return;
		}
		const out = await runWorkflowTool({ tool: 'buddy_execution_logs', args: { executionId } }, deps);
		// Real field names (originalWorkflowTaskName, order arg) resolved without a GraphQL error.
		assert.match(out, new RegExp(`Execution ${executionId}: \\d+ task\\(s\\), \\d+ failed`), out);
	});

	test('buddy_workflow_search builds the cross-org index and finds a workflow with its org name', async () => {
		// First call builds the cache (validates the accessible-orgs + workflows-list queries live).
		const all = await runWorkflowTool({ tool: 'buddy_workflow_search', args: { refresh: true } }, deps);
		assert.match(all, /index: \d+ workflows across \d+ org\(s\)/, all);

		// The configured sandbox workflow should be findable; results carry the org name.
		const name = (
			JSON.parse(
				await runWorkflowTool(
					{ tool: 'buddy_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
					deps,
				),
			) as GraphSummary
		).workflow.name;
		const hit = await runWorkflowTool({ tool: 'buddy_workflow_search', args: { query: name } }, deps);
		assert.ok(hit.includes(WORKFLOW_ID), `search should surface the workflow id\n${hit}`);
		assert.match(hit, /org: .+ \(/, 'each result shows the org name');
	});

	test('buddy_workflow_get surfaces the org name for the approval args', async () => {
		const summary = JSON.parse(
			await runWorkflowTool(
				{ tool: 'buddy_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
				deps,
			),
		) as GraphSummary;
		assert.ok(summary.workflow.orgName && summary.workflow.orgName !== ORG_ID, 'orgName is a name, not the id');
	});

	test('buddy_workflow_edit round-trips a transition label (content-neutral)', async () => {
		const before = JSON.parse(
			await runWorkflowTool(
				{ tool: 'buddy_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
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
					tool: 'buddy_workflow_edit',
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
					{ tool: 'buddy_workflow_get', args: { workflowId: WORKFLOW_ID, orgId: ORG_ID } },
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

	test('buddy_workflow_edit preserves all advanced task settings and parses a JSON-string input (#81)', async function () {
		// Discover the org's core pack id so the seeded override is valid and portable.
		const cfgs = (await deps.execute(
			'query ($orgId: ID!) { packConfigs(where: { orgId: $orgId }) { packId pack { ref } } }',
			{
				orgId: ORG_ID,
			},
		)) as { data?: { packConfigs?: ({ packId?: string; pack?: { ref?: string } } | null)[] } };
		const corePackId = (cfgs.data?.packConfigs ?? []).find(c => c?.pack?.ref === 'core')?.packId;
		if (!corePackId) {
			log.debug('#81 round-trip: no core pack config found — skipping');
			this.skip();
		}

		const created = (await deps.execute(
			'mutation ($workflow: WorkflowInput!) { createWorkflow(workflow: $workflow) { id } }',
			{
				workflow: { orgId: ORG_ID, name: '[RB TEST] #81 action-edit round-trip' },
			},
		)) as { data?: { createWorkflow?: { id?: string } }; errors?: unknown };
		const wfId = created.data?.createWorkflow?.id;
		assert.ok(wfId, `createWorkflow returned an id (${JSON.stringify(created.errors)})`);

		try {
			// Seed a noop task carrying a nested-object input via the high-level tool.
			await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
					args: {
						workflowId: wfId,
						workflowName: '[RB TEST] #81 action-edit round-trip',
						orgId: ORG_ID,
						orgName: ORG_ID,
						operations: [
							{ op: 'add_task', name: 'probe', action: 'core.noop', input: { a: 1, nested: { b: 2 } } },
						],
					},
				},
				deps,
			);

			// Attach a pack override (the integration-override the tool must not drop)
			// by resending the read-back task with packOverrides added.
			const read = (await deps.execute(
				'query ($where: WorkflowWhereInput) { workflow(where: $where) { id name orgId tasks { id name actionId input metadata transitionMode join next { when label do publish } } } }',
				{ where: { id: wfId, orgId: ORG_ID } },
			)) as { data?: { workflow?: { name?: string; tasks?: Record<string, unknown>[] } } };
			const probe = (read.data?.workflow?.tasks ?? []).find(t => t.name === 'probe')!;
			assert.ok(probe, 'probe task created');
			// Load the task with a broad spread of advanced settings; the edit below
			// touches none of them, so every one must survive the round-trip.
			const seededTask = {
				...probe,
				description: 'advanced settings probe',
				transitionMode: 'FOLLOW_ALL',
				join: 2,
				publishResultAs: 'probe_result',
				timeout: 300,
				humanSecondsSaved: 42,
				isMocked: true,
				mockInput: { sample: 'value' },
				runAsOrgId: ORG_ID,
				retry: { count: '3', delay: '5', when: '{{ FAILED }}' },
				with: { items: '{{ CTX.list }}', concurrency: '4' },
				metadata: { ...(probe.metadata as Record<string, unknown>), note: 'keep me' },
				packOverrides: [{ packId: corePackId, configSelectionMode: 'USE_DEFAULT' }],
			};
			const seeded = (await deps.execute(
				'mutation ($workflow: WorkflowInput!) { updateWorkflow(workflow: $workflow, createPatch: false) { tasks { name packOverrides { packId } } } }',
				{ workflow: { id: wfId, orgId: ORG_ID, name: read.data!.workflow!.name, tasks: [seededTask] } },
			)) as {
				data?: { updateWorkflow?: { tasks?: { name?: string; packOverrides?: { packId?: string }[] }[] } };
				errors?: unknown;
			};
			assert.ok(
				seeded.data?.updateWorkflow?.tasks?.[0]?.packOverrides?.length,
				`seeding the advanced settings succeeded (${JSON.stringify(seeded.errors)})`,
			);

			// The action edit under test touches ONLY the input (via a JSON string — the
			// shape that used to be stored as a char-indexed blob). Everything else on
			// the task must be carried through untouched.
			await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
					args: {
						workflowId: wfId,
						workflowName: read.data!.workflow!.name,
						orgId: ORG_ID,
						orgName: ORG_ID,
						operations: [
							{ op: 'update_task', name: 'probe', set: { input: '{"a": 9, "nested": {"b": 8}}' } },
						],
					},
				},
				deps,
			);

			const after = (await deps.execute(
				'query ($where: WorkflowWhereInput) { workflow(where: $where) { tasks { name input description transitionMode join publishResultAs timeout humanSecondsSaved isMocked mockInput runAsOrgId metadata retry { count delay when } with { items concurrency } packOverrides { packId configSelectionMode } } } }',
				{ where: { id: wfId, orgId: ORG_ID } },
			)) as { data?: { workflow?: { tasks?: Record<string, unknown>[] } } };
			const edited = (after.data?.workflow?.tasks ?? []).find(t => t.name === 'probe')! as Record<
				string,
				unknown
			>;
			assert.deepStrictEqual(
				edited.input,
				{ a: 9, nested: { b: 8 } },
				'JSON-string input parsed to an object, not a char-indexed blob',
			);
			// Every advanced setting survived the unrelated input edit.
			assert.strictEqual(edited.description, 'advanced settings probe', 'description preserved');
			assert.strictEqual(edited.transitionMode, 'FOLLOW_ALL', 'transitionMode preserved');
			assert.strictEqual(edited.join, 2, 'join preserved');
			assert.strictEqual(edited.publishResultAs, 'probe_result', 'publishResultAs preserved');
			assert.strictEqual(edited.timeout, 300, 'timeout preserved');
			assert.strictEqual(edited.humanSecondsSaved, 42, 'humanSecondsSaved preserved');
			assert.strictEqual(edited.isMocked, true, 'isMocked preserved');
			assert.deepStrictEqual(edited.mockInput, { sample: 'value' }, 'mockInput preserved');
			assert.strictEqual(edited.runAsOrgId, ORG_ID, 'runAsOrgId preserved');
			assert.deepStrictEqual(edited.retry, { count: '3', delay: '5', when: '{{ FAILED }}' }, 'retry preserved');
			assert.deepStrictEqual(edited.with, { items: '{{ CTX.list }}', concurrency: '4' }, 'with (loop) preserved');
			assert.strictEqual(
				(edited.metadata as Record<string, unknown>)?.note,
				'keep me',
				'custom metadata preserved',
			);
			const coreOverride = (
				(edited.packOverrides as { packId?: string; configSelectionMode?: string }[]) ?? []
			).find(o => o.packId === corePackId);
			assert.deepStrictEqual(
				coreOverride,
				{ packId: corePackId, configSelectionMode: 'USE_DEFAULT' },
				'the per-task integration override survived the edit with its full shape intact',
			);
		} finally {
			await deps.execute('mutation ($id: ID!) { deleteWorkflow(id: $id) }', { id: wfId });
		}
	});

	test('buddy_workflow_edit leaves workflow-level settings (output, tags, notes, humanSecondsSaved) intact', async function () {
		// Unlike the tasks array (a full replace), updateWorkflow leaves omitted
		// TOP-LEVEL fields untouched, so workflowToInput can omit output/tags/notes
		// without wiping them. This guards that partial-update guarantee — and catches
		// a regression where workflowToInput starts sending an empty value that clobbers.
		const created = (await deps.execute(
			'mutation ($workflow: WorkflowInput!) { createWorkflow(workflow: $workflow) { id } }',
			{ workflow: { orgId: ORG_ID, name: '[RB TEST] workflow-level round-trip' } },
		)) as { data?: { createWorkflow?: { id?: string } }; errors?: unknown };
		const wfId = created.data?.createWorkflow?.id;
		assert.ok(wfId, `createWorkflow returned an id (${JSON.stringify(created.errors)})`);

		try {
			// Seed a task plus workflow-level output, a note, and humanSecondsSaved;
			// add a tag too when the org has one.
			await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
					args: {
						workflowId: wfId,
						workflowName: '[RB TEST] workflow-level round-trip',
						orgId: ORG_ID,
						orgName: ORG_ID,
						operations: [{ op: 'add_task', name: 'noop1', action: 'core.noop' }],
					},
				},
				deps,
			);
			const read = (await deps.execute(
				'query ($where: WorkflowWhereInput) { workflow(where: $where) { name tasks { id name actionId input metadata transitionMode join next { when label do publish } } } }',
				{ where: { id: wfId, orgId: ORG_ID } },
			)) as { data?: { workflow?: { name?: string; tasks?: Record<string, unknown>[] } } };
			const tags = (await deps.execute('query ($where: TagWhereInput) { tags(where: $where) { id } }', {
				where: { orgId: ORG_ID },
			})) as { data?: { tags?: ({ id?: string } | null)[] } };
			const tagId = (tags.data?.tags ?? []).find(t => t?.id)?.id;

			const seedFields: Record<string, unknown> = {
				humanSecondsSaved: 777,
				output: [{ audit_out: '{{ 1 }}' }],
				notes: [{ title: 'Sticky', content: 'remember me', index: 0 }],
			};
			if (tagId) seedFields.tagIds = [tagId];
			await deps.execute(
				'mutation ($workflow: WorkflowInput!) { updateWorkflow(workflow: $workflow, createPatch: false) { id } }',
				{
					workflow: {
						id: wfId,
						orgId: ORG_ID,
						name: read.data!.workflow!.name,
						tasks: read.data!.workflow!.tasks,
						...seedFields,
					},
				},
			);

			// A content-neutral edit (workflowToInput omits these top-level fields).
			await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
					args: {
						workflowId: wfId,
						workflowName: read.data!.workflow!.name,
						orgId: ORG_ID,
						orgName: ORG_ID,
						operations: [{ op: 'add_task', name: 'noop2', action: 'core.noop' }],
					},
				},
				deps,
			);

			const after = (await deps.execute(
				'query ($where: WorkflowWhereInput) { workflow(where: $where) { humanSecondsSaved output tags { id } notes { title content } } }',
				{ where: { id: wfId, orgId: ORG_ID } },
			)) as {
				data?: {
					workflow?: {
						humanSecondsSaved?: number;
						output?: unknown;
						tags?: { id?: string }[];
						notes?: { title?: string; content?: string }[];
					};
				};
			};
			const wf = after.data!.workflow!;
			assert.strictEqual(wf.humanSecondsSaved, 777, 'humanSecondsSaved left intact');
			assert.deepStrictEqual(wf.output, [{ audit_out: '{{ 1 }}' }], 'output definitions left intact');
			assert.deepStrictEqual(wf.notes, [{ title: 'Sticky', content: 'remember me' }], 'canvas notes left intact');
			if (tagId)
				assert.ok(
					(wf.tags ?? []).some(t => t.id === tagId),
					'tag left intact',
				);
		} finally {
			await deps.execute('mutation ($id: ID!) { deleteWorkflow(id: $id) }', { id: wfId });
		}
	});
});
