import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { _resetApprovedMutationScopes, approveMutationScope, type GraphqlToolDeps } from './graphqlTool';
import {
	applyOperations,
	isWorkflowTool,
	normalizePublish,
	runWorkflowTool,
	WORKFLOW_EDIT_TOOL_NAME,
	workflowEditConfirmation,
	workflowEditScope,
	workflowToInput,
	type WorkflowOperation,
} from './workflowTools';

const { suite, test, setup } = Mocha;

// A minimal two-task workflow: start (core.noop) -> end (core.noop).
function sampleTasks() {
	return [
		{
			id: 'aa01',
			name: 'start',
			actionId: 'noop-id',
			action: { ref: 'core.noop' },
			input: {},
			next: [{ when: '{{ SUCCEEDED }}', label: '', do: ['bb02'], publish: [] }],
		},
		{ id: 'bb02', name: 'end', actionId: 'noop-id', action: { ref: 'core.noop' }, input: {}, next: [] },
	];
}

function sampleWorkflow() {
	return {
		id: 'wf-1',
		name: 'Sample',
		orgId: 'org-1',
		updatedAt: '1000',
		tasks: sampleTasks(),
	};
}

const NO_ACTIONS = new Map<string, string>();
const NOOP_REF = new Map([['core.noop', 'noop-id']]);

suite('Unit: workflowTools', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
	});

	test('isWorkflowTool recognizes the workflow tools', () => {
		assert.ok(isWorkflowTool('rewst_workflow_get'));
		assert.ok(isWorkflowTool('rewst_action_search'));
		assert.ok(isWorkflowTool('rewst_workflow_edit'));
		assert.ok(!isWorkflowTool('rewst_graphql'));
	});

	suite('normalizePublish()', () => {
		test('keeps {key,value} array form', () => {
			assert.deepStrictEqual(normalizePublish([{ key: 'a', value: '1' }]), [{ key: 'a', value: '1' }]);
		});
		test('converts {key: value} object form', () => {
			assert.deepStrictEqual(normalizePublish({ a: '1', b: '2' }), [
				{ key: 'a', value: '1' },
				{ key: 'b', value: '2' },
			]);
		});
		test('converts array of single-key objects', () => {
			assert.deepStrictEqual(normalizePublish([{ a: '1' }]), [{ key: 'a', value: '1' }]);
		});
		test('null yields empty', () => {
			assert.deepStrictEqual(normalizePublish(null), []);
		});
	});

	suite('workflowToInput()', () => {
		test('uses actionId (not action.ref) and normalizes publish', () => {
			const w = sampleWorkflow();
			w.tasks[0].next[0].publish = [{ key: 'k', value: 'v' }] as never;
			const input = workflowToInput(w as never, w.tasks as never);
			const tasks = input.tasks as Record<string, unknown>[];
			assert.strictEqual(tasks[0].actionId, 'noop-id');
			assert.ok(!('action' in tasks[0]), 'action object is not sent');
			const next = tasks[0].next as Record<string, unknown>[];
			assert.deepStrictEqual(next[0].publish, [{ key: 'k', value: 'v' }]);
			assert.deepStrictEqual(next[0].do, ['bb02']);
		});
	});

	suite('applyOperations()', () => {
		test('add_task generates a de-dashed hex id and resolves the action ref', () => {
			const ops: WorkflowOperation[] = [{ op: 'add_task', name: 'notify', action: 'core.noop', input: { x: 1 } }];
			const { tasks, applied } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			const added = tasks.find(t => t.name === 'notify')!;
			assert.ok(added, 'task added');
			assert.match(added.id, /^[0-9a-f]{32}$/, 'id is de-dashed hex');
			assert.strictEqual(added.actionId, 'noop-id');
			assert.deepStrictEqual(added.input, { x: 1 });
			assert.strictEqual(applied.length, 1);
		});

		test('connect links by name, including a task added in the same edit', () => {
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'notify', action: 'core.noop' },
				{ op: 'connect', from: 'end', to: 'notify', when: '{{ SUCCEEDED }}' },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			const end = tasks.find(t => t.name === 'end')!;
			const notify = tasks.find(t => t.name === 'notify')!;
			assert.strictEqual(end.next!.length, 1);
			assert.deepStrictEqual(end.next![0].do, [notify.id]);
		});

		test('update_task merges set fields', () => {
			const ops: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { input: { msg: 'hi' } } }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(tasks.find(t => t.name === 'start')!.input, { msg: 'hi' });
		});

		test('delete_task removes the task and edges pointing at it', () => {
			const ops: WorkflowOperation[] = [{ op: 'delete_task', name: 'end' }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.ok(!tasks.some(t => t.name === 'end'), 'end removed');
			// start's only edge pointed at end, so it is dropped.
			assert.strictEqual(tasks.find(t => t.name === 'start')!.next!.length, 0);
		});

		test('disconnect removes the edge to a target', () => {
			const ops: WorkflowOperation[] = [{ op: 'disconnect', from: 'start', to: 'end' }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.strictEqual(tasks.find(t => t.name === 'start')!.next!.length, 0);
		});

		test('set_transition edits the single transition', () => {
			const ops: WorkflowOperation[] = [{ op: 'set_transition', from: 'start', set: { label: 'go' } }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.strictEqual(tasks.find(t => t.name === 'start')!.next![0].label, 'go');
		});

		test('reposition sets layout offsets', () => {
			const ops: WorkflowOperation[] = [{ op: 'reposition', from: 'start', top: 12, left: 34 }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			const edge = tasks.find(t => t.name === 'start')!.next![0];
			assert.strictEqual(edge.top, 12);
			assert.strictEqual(edge.left, 34);
		});

		test('does not mutate the input task list', () => {
			const original = sampleTasks();
			applyOperations(original as never, [{ op: 'delete_task', name: 'end' }], NO_ACTIONS);
			assert.strictEqual(original.length, 2, 'source untouched');
		});

		test('errors on unknown task, unknown op, and unresolved action', () => {
			assert.throws(
				() => applyOperations(sampleTasks() as never, [{ op: 'connect', from: 'x', to: 'end' }], NO_ACTIONS),
				/No task/,
			);
			assert.throws(
				() => applyOperations(sampleTasks() as never, [{ op: 'frobnicate' }], NO_ACTIONS),
				/Unknown operation/,
			);
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[{ op: 'add_task', name: 'n', action: 'pack.thing' }],
						NO_ACTIONS,
					),
				/resolve action/,
			);
		});
	});

	suite('workflowEditScope()', () => {
		test('returns the scope when all four fields are present', () => {
			const scope = workflowEditScope(WORKFLOW_EDIT_TOOL_NAME, {
				workflowId: 'wf-1',
				workflowName: 'WF',
				orgId: 'org-1',
				orgName: 'Acme',
				operations: [],
			});
			assert.deepStrictEqual(scope, { scopeId: 'wf-1', scopeName: 'WF', orgId: 'org-1', orgName: 'Acme' });
		});
		test('undefined when a field is missing or wrong tool', () => {
			assert.strictEqual(workflowEditScope(WORKFLOW_EDIT_TOOL_NAME, { workflowId: 'wf-1' }), undefined);
			assert.strictEqual(
				workflowEditScope('rewst_graphql', { workflowId: 'a', workflowName: 'b', orgId: 'c', orgName: 'd' }),
				undefined,
			);
		});
	});

	suite('workflowEditConfirmation()', () => {
		const fullArgs = {
			workflowId: 'wf-1',
			workflowName: 'WF',
			orgId: 'org-1',
			orgName: 'Acme',
			operations: [{ op: 'add_task', name: 'notify', action: 'core.noop' }],
		};

		test('summarizes operations and names the workflow', () => {
			const confirmation = workflowEditConfirmation(WORKFLOW_EDIT_TOOL_NAME, fullArgs);
			assert.ok(confirmation);
			assert.match(confirmation!.message, /WF/);
			assert.match(confirmation!.message, /add_task notify/);
		});

		test('undefined once the workflow scope is approved this session', () => {
			approveMutationScope({ scopeId: 'wf-1', scopeName: 'WF', orgId: 'org-1', orgName: 'Acme' });
			assert.strictEqual(workflowEditConfirmation(WORKFLOW_EDIT_TOOL_NAME, fullArgs), undefined);
		});
	});

	suite('runWorkflowTool()', () => {
		// A deps.execute that routes by operation name and records calls.
		function makeDeps(over: Partial<{ updateResults: { data?: unknown; errors?: unknown }[] }> = {}) {
			const calls: { query: string; variables?: Record<string, unknown> }[] = [];
			const updateResults = over.updateResults ?? [
				{ data: { updateWorkflow: { id: 'wf-1', updatedAt: '2000' } } },
			];
			let updateIndex = 0;
			const execute: GraphqlToolDeps['execute'] = async (query, variables) => {
				calls.push({ query, variables });
				if (query.includes('RewstBuddyWorkflowGet')) {
					const updatedAt =
						calls.filter(c => c.query.includes('RewstBuddyWorkflowGet')).length === 1 ? '1000' : '1500';
					return { data: { workflow: { ...sampleWorkflow(), updatedAt } } };
				}
				if (query.includes('RewstBuddyActionSearch')) {
					return { data: { actionsForOrg: [{ id: 'noop-id', ref: 'core.noop', name: 'noop' }] } };
				}
				if (query.includes('RewstBuddyWorkflowUpdate')) {
					return updateResults[Math.min(updateIndex++, updateResults.length - 1)];
				}
				return { data: {} };
			};
			const deps: GraphqlToolDeps = { isEnabled: () => true, confirmMutation: async () => true, execute };
			return { deps, calls };
		}

		test('rewst_workflow_get returns a normalized graph', async () => {
			const { deps } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'rewst_workflow_get', args: { workflowId: 'wf-1', orgId: 'org-1' } },
				deps,
			);
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.workflow.name, 'Sample');
			assert.strictEqual(parsed.nodes.length, 2);
			assert.strictEqual(parsed.edges[0].from, 'start');
			assert.deepStrictEqual(parsed.edges[0].to, ['end (bb02)']);
		});

		test('rewst_action_search returns ranked matches', async () => {
			const { deps } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'rewst_action_search', args: { orgId: 'org-1', query: 'noop' } },
				deps,
			);
			assert.match(output, /core\.noop/);
		});

		test('rewst_workflow_edit applies ops and reports the new version token', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: 'rewst_workflow_edit',
					args: {
						workflowId: 'wf-1',
						workflowName: 'Sample',
						orgId: 'org-1',
						orgName: 'Acme',
						operations: [{ op: 'add_task', name: 'notify', action: 'core.noop' }],
					},
				},
				deps,
			);
			assert.match(output, /Applied 1 operation/);
			assert.match(output, /2000/);
			const update = calls.find(c => c.query.includes('RewstBuddyWorkflowUpdate'))!;
			assert.strictEqual(update.variables!.openedAt, '1000', 'openedAt is the updatedAt read at fetch');
		});

		test('rewst_workflow_edit retries once on a version conflict with the fresh token', async () => {
			const { deps, calls } = makeDeps({
				updateResults: [
					{ errors: [{ message: 'A newer version of this workflow exists.' }] },
					{ data: { updateWorkflow: { id: 'wf-1', updatedAt: '3000' } } },
				],
			});
			const output = await runWorkflowTool(
				{
					tool: 'rewst_workflow_edit',
					args: {
						workflowId: 'wf-1',
						workflowName: 'Sample',
						orgId: 'org-1',
						orgName: 'Acme',
						operations: [{ op: 'connect', from: 'end', to: 'start' }],
					},
				},
				deps,
			);
			assert.match(output, /3000/);
			const updates = calls.filter(c => c.query.includes('RewstBuddyWorkflowUpdate'));
			assert.strictEqual(updates.length, 2, 'retried once');
			assert.strictEqual(updates[1].variables!.openedAt, '1500', 'retry uses the re-read token');
		});

		test('rewst_workflow_edit refuses when scope fields are missing', async () => {
			const { deps } = makeDeps();
			await assert.rejects(
				() =>
					runWorkflowTool(
						{ tool: 'rewst_workflow_edit', args: { workflowId: 'wf-1', operations: [{ op: 'add_task' }] } },
						deps,
					),
				/requires non-empty/,
			);
		});
	});
});
