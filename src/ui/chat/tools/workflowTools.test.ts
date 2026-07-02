import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { SessionManager } from '@sessions';
import { _resetApprovedMutationScopes, approveMutationScope, type GraphqlToolDeps } from './graphqlTool';
import {
	applyOperations,
	autoLayout,
	isWorkflowTool,
	normalizePublish,
	runWorkflowTool,
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_TOOL_SPECS,
	_resetWorkflowIndexForTesting,
	sentValueDivergences,
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
			metadata: { x: 0, y: 0 },
			next: [{ when: '{{ SUCCEEDED }}', label: '', do: ['bb02'], publish: [] }],
		},
		{
			id: 'bb02',
			name: 'end',
			actionId: 'noop-id',
			action: { ref: 'core.noop' },
			input: {},
			metadata: { x: 0, y: 120 },
			next: [],
		},
	];
}

function sampleWorkflow() {
	return {
		id: 'wf-1',
		name: 'Sample',
		orgId: 'org-1',
		organization: { id: 'org-1', name: 'Test Org' },
		input: ['email'],
		action: {
			parameters: {
				email: {
					type: 'string',
					label: 'Email',
					default: '',
					required: true,
					multiline: false,
					description: 'addr',
				},
			},
		},
		updatedAt: '1000',
		output: [{ user_found: '{{ CTX.user_found|d(false) }}' }],
		tasks: sampleTasks(),
	};
}

const NO_ACTIONS = new Map<string, string>();
const NOOP_REF = new Map([['core.noop', 'noop-id']]);

suite('Unit: workflowTools', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		_resetApprovedMutationScopes();
		_resetWorkflowIndexForTesting();
	});

	test('isWorkflowTool recognizes the workflow tools', () => {
		assert.ok(isWorkflowTool('buddy_workflow_get'));
		assert.ok(isWorkflowTool('buddy_action_search'));
		assert.ok(isWorkflowTool('buddy_workflow_edit'));
		assert.ok(!isWorkflowTool('buddy_graphql'));
	});

	test('buddy_workflow_get spec reserves full detail for ids and positions, not ordinary edits', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === 'buddy_workflow_get');
		assert.ok(spec, 'buddy_workflow_get spec exists');
		assert.match(spec.args, /"summary" \(default\)/);
		assert.match(spec.description, /summary.*sufficient.*name-based edits/i);
		assert.match(spec.description, /full.*task ids, transition ids, or canvas positions/i);
		assert.doesNotMatch(spec.description, /full" only when you are preparing to make workflow edits/i);
		const detail = (spec.inputSchema as { properties: { detail: { description: string } } }).properties.detail;
		assert.match(detail.description, /full.*only when you need task ids, transition ids, or canvas positions/i);
	});

	test('buddy_workflow_edit spec does not expose task mode or join controls', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.doesNotMatch(spec.description, /\btransitionMode\b|\bjoin\b|FOLLOW_ALL|FOLLOW_FIRST/);
		assert.match(spec.description, /does not expose parallel task controls/i);
	});

	test('buddy_workflow_edit spec teaches sub-workflow composition through set_output', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.match(spec.description, /set_output \{outputs/, 'set_output is listed as an operation');
		assert.match(spec.description, /RESULT\.<name>/, 'ties a sub-workflow call result to the set_output contract');
		assert.match(spec.description, /prefer composition/i, 'recommends composing over one giant canvas');
		assert.match(
			spec.description,
			/sign to split/i,
			'names the smell that should push a build toward sub-workflows',
		);
	});

	test('buddy_workflow_edit spec states transition, publish, and loop semantics', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.match(
			spec.description,
			/at most one outgoing transition.*first.*listed order/i,
			'documents first-match transition evaluation',
		);
		assert.match(
			spec.description,
			/publish entries apply whenever that transition is taken, including on \{\{ FAILED \}\}/i,
			'documents publish firing on failure edges',
		);
		assert.match(spec.description, /\{\{ item\(\) \}\}/, 'documents the with.items current-element callable');
		assert.match(
			spec.description,
			/update_task \{id\|name, set:\{name\?, input\?, action\? or subWorkflowId\?, publishResultAs\?, timeout\?, description\?, with\?\}\}/,
			'enumerates the update_task settable fields',
		);
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

	suite('sentValueDivergences()', () => {
		test('flags a nested key the server dropped, with its path', () => {
			const lines = sentValueDivergences(
				{ json_body: { status: { name: 'In Progress' } } },
				{ json_body: { status: {} } },
				'input',
			);
			assert.strictEqual(lines.length, 1);
			assert.match(lines[0], /^input\.json_body\.status\.name: sent/);
			assert.match(lines[0], /not stored/);
		});

		test('flags a string the server coerced into an empty object', () => {
			const lines = sentValueDivergences({ json_body: '{{ CTX.body }}' }, { json_body: {} }, 'input');
			assert.strictEqual(lines.length, 1);
			assert.match(lines[0], /^input\.json_body: sent/);
		});

		test('ignores extra keys the server added', () => {
			assert.deepStrictEqual(sentValueDivergences({ a: 1 }, { a: 1, server_default: true }, 'input'), []);
		});

		test('deep-equal values, including arrays, produce no divergence', () => {
			const value = { list: [1, { x: 'y' }], flag: false };
			assert.deepStrictEqual(sentValueDivergences(value, { ...value, extra: 1 }, 'input'), []);
		});

		test('tolerates harmless primitive coercion (1 vs "1")', () => {
			assert.deepStrictEqual(sentValueDivergences({ concurrency: 1 }, { concurrency: '1' }, 'with'), []);
		});

		test('flags an array the server truncated', () => {
			const lines = sentValueDivergences({ ids: ['a', 'b'] }, { ids: ['a'] }, 'input');
			assert.strictEqual(lines.length, 1);
			assert.match(lines[0], /^input\.ids: sent/);
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

		test('carries the run/call form parameters through on a non-input edit', () => {
			// updateWorkflow replaces the whole payload, so the action.parameters that
			// drive the run/call form must be resent or they are silently dropped.
			const w = sampleWorkflow();
			const input = workflowToInput(w as never, w.tasks as never);
			assert.deepStrictEqual(input.parameters, w.action.parameters, 'parameters preserved');
		});

		test('output is sent only when a set_output override provides it', () => {
			// The top level of updateWorkflow behaves as a patch: omitting output
			// leaves it untouched server-side, so an unrelated edit must not resend
			// the read-back value — only set_output writes it.
			const w = sampleWorkflow();
			const without = workflowToInput(w as never, w.tasks as never);
			assert.ok(!('output' in without), 'read-back output is not resent on unrelated edits');
			const withOverride = workflowToInput(w as never, w.tasks as never, {
				output: [{ done: '{{ true }}' }],
			});
			assert.deepStrictEqual(withOverride.output, [{ done: '{{ true }}' }], 'set_output override wins');
		});

		test('resends a task pack override (integration override) so an edit does not drop it', () => {
			// updateWorkflow replaces the whole task; without resending packOverrides
			// the task silently reverts to the default integration (#81).
			const w = sampleWorkflow();
			(w.tasks[0] as Record<string, unknown>).packOverrides = [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_SELECTED_ID',
					configFallbackMode: 'FAIL_ACTION',
					searchInput: null,
				},
			];
			// The API returns an empty list for a task with no override; it stays empty.
			(w.tasks[1] as Record<string, unknown>).packOverrides = [];
			const input = workflowToInput(w as never, w.tasks as never);
			const tasks = input.tasks as Record<string, unknown>[];
			assert.deepStrictEqual(tasks[0].packOverrides, [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_SELECTED_ID',
					configFallbackMode: 'FAIL_ACTION',
				},
			]);
			// A task without overrides resends an empty list, never a stray null entry.
			assert.deepStrictEqual(tasks[1].packOverrides, []);
		});

		test('resends every advanced task setting unchanged (no edit silently drops one)', () => {
			// updateWorkflow replaces the whole task, so every advanced setting the
			// builder can put on a task must survive the read -> write round-trip.
			const loaded = {
				id: 'tt01',
				name: 'loaded',
				actionId: 'act-1',
				action: { ref: 'some.action' },
				description: 'does a thing',
				input: { a: 1, nested: { b: 2 } },
				metadata: { x: 10, y: 20, note: 'keep me' },
				transitionMode: 'FOLLOW_ALL',
				publishResultAs: 'result_alias',
				join: 2,
				timeout: 300,
				humanSecondsSaved: 42,
				isMocked: true,
				mockInput: { sample: 'value' },
				runAsOrgId: 'org-9',
				securitySchema: { policy: 'strict' },
				packOverrides: [{ packId: 'pack-1', packConfigId: 'cfg-1', configSelectionMode: 'USE_SELECTED_ID' }],
				retry: { count: '3', delay: '5', when: '{{ FAILED }}' },
				with: { items: '{{ CTX.list }}', concurrency: '4' },
				next: [{ when: '{{ SUCCEEDED }}', label: 'ok', do: [], publish: [{ key: 'k', value: 'v' }] }],
			};
			const w = { ...sampleWorkflow(), tasks: [loaded] };
			const out = (workflowToInput(w as never, [loaded] as never).tasks as Record<string, unknown>[])[0];
			// Every advanced setting, including an existing task mode/join, is present and unchanged on the write payload.
			for (const field of [
				'description',
				'publishResultAs',
				'timeout',
				'humanSecondsSaved',
				'isMocked',
				'mockInput',
				'runAsOrgId',
				'securitySchema',
				'retry',
				'with',
			] as const) {
				assert.deepStrictEqual(out[field], (loaded as Record<string, unknown>)[field], `${field} preserved`);
			}
			assert.deepStrictEqual(out.input, loaded.input, 'input preserved');
			assert.deepStrictEqual(out.metadata, loaded.metadata, 'metadata (incl. extra keys) preserved');
			assert.deepStrictEqual(out.packOverrides, loaded.packOverrides, 'pack override preserved');
			assert.strictEqual(out.transitionMode, 'FOLLOW_ALL', 'an existing fan-out mode survives the round-trip');
			assert.strictEqual(out.join, 2, 'an existing join value survives the round-trip');
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

		test('connect replaces a pre-existing targetless terminal with the real success edge', () => {
			// A task saved once carries a terminal {{ SUCCEEDED }} with do:[]. Connecting
			// from it must not leave that empty fallback behind once a real success edge exists.
			const tasksIn = sampleTasks();
			tasksIn[1].next = [{ when: '{{ SUCCEEDED }}', label: '', do: [], publish: [] }];
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'after', action: 'core.noop' },
				{ op: 'connect', from: 'end', to: 'after' },
			];
			const { tasks } = applyOperations(tasksIn as never, ops, NOOP_REF);
			const end = tasks.find(t => t.name === 'end')!;
			const after = tasks.find(t => t.name === 'after')!;
			assert.strictEqual(end.next!.length, 1);
			assert.deepStrictEqual(end.next![0].do, [after.id], 'real success edge is the only success fallback');
		});

		test('add_task with subWorkflowId calls another workflow (its id is the action id)', () => {
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'call_child', subWorkflowId: '019ecc4c-b826-70b0-a8c7-e87ff2377833' },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			const call = tasks.find(t => t.name === 'call_child')!;
			assert.strictEqual(
				call.actionId,
				'019ecc4c-b826-70b0-a8c7-e87ff2377833',
				'sub-workflow id becomes the action id',
			);
		});

		test('set_inputs builds the input name list and inputSchema, never varsSchema', () => {
			const ops: WorkflowOperation[] = [
				{
					op: 'set_inputs',
					inputs: [
						{ name: 'email', type: 'string', title: 'Email', description: 'addr', required: true },
						{ name: 'count', type: 'integer' },
						{ name: 'drop', type: 'boolean', default: false },
					],
				},
			];
			const { workflow } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(workflow.input, ['email', 'count', 'drop'], 'ordered input name list');
			const schema = workflow.inputSchema as {
				type: string;
				required: string[];
				properties: Record<string, { type: string; title: string; default?: unknown }>;
			};
			assert.strictEqual(schema.type, 'object');
			assert.deepStrictEqual(schema.required, ['email'], 'only required inputs listed');
			assert.strictEqual(schema.properties.email.type, 'string');
			assert.strictEqual(schema.properties.email.title, 'Email');
			assert.strictEqual(schema.properties.count.title, 'count', 'title defaults to the name');
			// parameters (action-parameter form) is what the UI input form actually reads.
			const params = workflow.parameters as Record<
				string,
				{ label: string; required: boolean; multiline: boolean; default: unknown }
			>;
			assert.strictEqual(params.email.label, 'Email', 'parameters use label, not title');
			assert.strictEqual(params.email.required, true);
			assert.strictEqual(params.count.required, false);
			assert.strictEqual(params.count.multiline, false);
			// Raw boolean/number defaults are wrapped as Jinja expressions, which Rewst needs.
			assert.strictEqual(params.drop.default, '{{ false }}', 'raw boolean default is Jinja-wrapped');
			assert.strictEqual(schema.properties.drop.default, '{{ false }}', 'inputSchema default is wrapped too');
			assert.ok(!('varsSchema' in workflow), 'varsSchema is never touched by set_inputs');
		});

		test('set_output builds the ordered single-key output list from an object map', () => {
			const ops: WorkflowOperation[] = [
				{
					op: 'set_output',
					outputs: { success: '{{ CTX.success|d(false) }}', data: '{{ CTX.data|d(None) }}' },
				},
			];
			const { workflow, applied } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(
				workflow.output,
				[{ success: '{{ CTX.success|d(false) }}' }, { data: '{{ CTX.data|d(None) }}' }],
				'stored as the API\'s ordered [{name: "<jinja>"}] list',
			);
			assert.match(applied[0], /set_output \(2: success, data\)/);
		});

		test('set_output accepts a {name, value} array and wraps raw scalars as Jinja', () => {
			const ops: WorkflowOperation[] = [
				{
					op: 'set_output',
					outputs: [
						{ name: 'enabled', value: true },
						{ name: 'count', value: 3 },
						{ name: 'log', value: '{{ CTX.automation_log|d([]) }}' },
					],
				},
			];
			const { workflow } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(workflow.output, [
				{ enabled: '{{ true }}' },
				{ count: '{{ 3 }}' },
				{ log: '{{ CTX.automation_log|d([]) }}' },
			]);
		});

		test('set_output with an empty array clears the outputs', () => {
			const ops: WorkflowOperation[] = [{ op: 'set_output', outputs: [] }];
			const { workflow } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(workflow.output, []);
		});

		test('set_output without outputs throws instead of clearing', () => {
			assert.throws(
				() => applyOperations(sampleTasks() as never, [{ op: 'set_output' }], NO_ACTIONS),
				/set_output requires "outputs"/,
			);
		});

		test('a new task defaults to FOLLOW_FIRST + join 1 and gets a terminal transition', () => {
			const { tasks } = applyOperations(
				sampleTasks() as never,
				[{ op: 'add_task', name: 'leaf', action: 'core.noop' }],
				NOOP_REF,
			);
			const leaf = tasks.find(t => t.name === 'leaf')!;
			assert.strictEqual(leaf.transitionMode, 'FOLLOW_FIRST');
			assert.strictEqual(leaf.join, 1);
			assert.strictEqual(leaf.next!.length, 1, 'unconnected task gets a success transition');
			assert.strictEqual(leaf.next![0].when, '{{ SUCCEEDED }}');
			assert.deepStrictEqual(leaf.next![0].do, []);
		});

		test('add_task ignores explicit task mode and join settings', () => {
			const { tasks } = applyOperations(
				sampleTasks() as never,
				[{ op: 'add_task', name: 'merge', action: 'core.noop', transitionMode: 'FOLLOW_ALL', join: 0 }],
				NOOP_REF,
			);
			const merge = tasks.find(t => t.name === 'merge')!;
			assert.strictEqual(merge.transitionMode, 'FOLLOW_FIRST');
			assert.strictEqual(merge.join, 1);
		});

		test('add_task reports back when it drops task mode/join inputs instead of silently ignoring them', () => {
			const { applied } = applyOperations(
				sampleTasks() as never,
				[{ op: 'add_task', name: 'merge', action: 'core.noop', transitionMode: 'FOLLOW_ALL', join: 0 }],
				NOOP_REF,
			);
			const line = applied.find(entry => entry.startsWith('add_task merge'));
			assert.ok(line, 'add_task is logged');
			assert.match(
				line!,
				/ignored transitionMode\/join/,
				'the dropped parallelism inputs are reported to the model',
			);
		});

		test('update_task reports back when it drops task mode/join inputs', () => {
			const { applied } = applyOperations(
				sampleTasks() as never,
				[{ op: 'update_task', name: 'start', set: { transitionMode: 'FOLLOW_ALL', join: 2 } }],
				NO_ACTIONS,
			);
			const line = applied.find(entry => entry.startsWith('update_task'));
			assert.ok(line, 'update_task is logged');
			assert.match(
				line!,
				/ignored transitionMode\/join/,
				'the dropped parallelism inputs are reported to the model',
			);
		});

		test('a clean add_task carries no ignored-input note', () => {
			const { applied } = applyOperations(
				sampleTasks() as never,
				[{ op: 'add_task', name: 'leaf', action: 'core.noop' }],
				NOOP_REF,
			);
			const line = applied.find(entry => entry.startsWith('add_task leaf'));
			assert.ok(line && !/ignored/.test(line), 'no note when no parallelism inputs are passed');
		});

		test('every existing task is normalized to an explicit FOLLOW_FIRST + join 1 on save', () => {
			// sampleTasks() leave transitionMode/join unset (Rewst would treat that as
			// FOLLOW_ALL at runtime); any edit must make the safe default explicit.
			const { tasks } = applyOperations(
				sampleTasks() as never,
				[{ op: 'set_transition', from: 'start', set: { label: 'go' } }],
				NO_ACTIONS,
			);
			for (const task of tasks) {
				assert.strictEqual(task.transitionMode, 'FOLLOW_FIRST', `${task.name} mode made explicit`);
				assert.strictEqual(task.join, 1, `${task.name} join made explicit`);
			}
		});

		test('normalization is fill-only: an explicit FOLLOW_ALL fan-out and join 0 survive', () => {
			const tasksIn = sampleTasks();
			(tasksIn[0] as { transitionMode?: string }).transitionMode = 'FOLLOW_ALL';
			(tasksIn[1] as { join?: number }).join = 0;
			const { tasks } = applyOperations(tasksIn as never, [], NO_ACTIONS);
			assert.strictEqual(tasks.find(t => t.name === 'start')!.transitionMode, 'FOLLOW_ALL', 'fan-out preserved');
			assert.strictEqual(tasks.find(t => t.name === 'end')!.join, 0, 'explicit join preserved');
		});

		test("editing one task never clobbers a sibling task's FOLLOW_ALL fan-out", () => {
			// The edit resends the whole workflow, so a forced default would silently
			// rewrite a parallel fan-out the user never touched.
			const tasksIn = sampleTasks();
			(tasksIn[0] as { transitionMode?: string }).transitionMode = 'FOLLOW_ALL';
			const { tasks } = applyOperations(
				tasksIn as never,
				[{ op: 'update_task', name: 'end', set: { description: 'touched' } }],
				NO_ACTIONS,
			);
			assert.strictEqual(
				tasks.find(t => t.name === 'start')!.transitionMode,
				'FOLLOW_ALL',
				'the untouched sibling keeps its fan-out',
			);
		});

		test('update_task merges set fields', () => {
			const ops: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { input: { msg: 'hi' } } }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(tasks.find(t => t.name === 'start')!.input, { msg: 'hi' });
		});

		test('update_task parses a JSON-string input back to an object (not a char-indexed blob)', () => {
			// MCP clients sometimes deliver input as a JSON string; assigning it verbatim
			// stored it as {"0":"{","1":"\"",...} and broke the action (#81).
			const ops: WorkflowOperation[] = [
				{
					op: 'update_task',
					name: 'start',
					set: { input: '{"top": 250, "client_kwargs": {"use_delegated_admin": true}}' },
				},
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(tasks.find(t => t.name === 'start')!.input, {
				top: 250,
				client_kwargs: { use_delegated_admin: true },
			});
		});

		test('add_task parses a JSON-string input back to an object', () => {
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'notify', action: 'core.noop', input: '{"x": 1}' },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			assert.deepStrictEqual(tasks.find(t => t.name === 'notify')!.input, { x: 1 });
		});

		test('a non-object input string is a hard error, not silent corruption', () => {
			const bad: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { input: 'not json' } }];
			assert.throws(() => applyOperations(sampleTasks() as never, bad, NO_ACTIONS), /must be a JSON object/);
			const scalar: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { input: '42' } }];
			assert.throws(
				() => applyOperations(sampleTasks() as never, scalar, NO_ACTIONS),
				/not a JSON array or scalar/,
			);
			// A non-string array/scalar is rejected too, not silently coerced to {}.
			const arr: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { input: [1, 2] } }];
			assert.throws(() => applyOperations(sampleTasks() as never, arr, NO_ACTIONS), /not an array or scalar/);
			const num: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { input: 7 } }];
			assert.throws(() => applyOperations(sampleTasks() as never, num, NO_ACTIONS), /not an array or scalar/);
		});

		test('an empty or whitespace-only input string clears to an empty object, not an error', () => {
			// An empty string is "no input", not malformed JSON — it yields {}.
			for (const value of ['', '   ']) {
				const ops: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { input: value } }];
				const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
				assert.deepStrictEqual(tasks.find(t => t.name === 'start')!.input, {}, `"${value}" -> {}`);
			}
		});

		test('update_task parses a JSON-string "with" loop config back to an object', () => {
			// `with` is a {items, concurrency} object and is vulnerable to the same
			// string-blob corruption as input; it must be parsed, not stored verbatim.
			const ops: WorkflowOperation[] = [
				{ op: 'update_task', name: 'start', set: { with: '{"items": "{{ CTX.list }}", "concurrency": "4"}' } },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(tasks.find(t => t.name === 'start')!.with, {
				items: '{{ CTX.list }}',
				concurrency: '4',
			});
		});

		test('update_task ignores task mode and join settings while still coercing timeout', () => {
			const ok: WorkflowOperation[] = [
				{ op: 'update_task', name: 'start', set: { transitionMode: 'FOLLOW_ALL', join: '2', timeout: '300' } },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ok, NO_ACTIONS);
			const start = tasks.find(t => t.name === 'start')!;
			assert.strictEqual(start.transitionMode, 'FOLLOW_FIRST');
			assert.strictEqual(start.join, 1);
			assert.strictEqual(start.timeout, 300);
			// A direct integer (non-string) is accepted as-is.
			const ints: WorkflowOperation[] = [
				{ op: 'update_task', name: 'start', set: { transitionMode: 'FOLLOW_ALL', join: 3, timeout: 400 } },
			];
			const direct = applyOperations(sampleTasks() as never, ints, NO_ACTIONS).tasks.find(
				t => t.name === 'start',
			)!;
			assert.strictEqual(direct.transitionMode, 'FOLLOW_FIRST');
			assert.strictEqual(direct.join, 1);
			assert.strictEqual(direct.timeout, 400);
			// timeout is GraphQL Int; a float — number or numeric string — is
			// rejected, not silently sent.
			const float: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { timeout: 1.5 } }];
			assert.throws(
				() => applyOperations(sampleTasks() as never, float, NO_ACTIONS),
				/timeout must be an integer/,
			);
			const floatStr: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { timeout: '1.5' } }];
			assert.throws(
				() => applyOperations(sampleTasks() as never, floatStr, NO_ACTIONS),
				/timeout must be an integer/,
			);
		});

		test('add_task ignores join and parses a JSON-string with', () => {
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'notify', action: 'core.noop', join: '0', with: '{"items": "{{ CTX.x }}"}' },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			const notify = tasks.find(t => t.name === 'notify')!;
			assert.strictEqual(notify.join, 1);
			assert.deepStrictEqual(notify.with, { items: '{{ CTX.x }}' });
		});

		test('update_task preserves a task pack override (integration override) it does not touch', () => {
			const tasks = sampleTasks();
			(tasks[0] as Record<string, unknown>).packOverrides = [{ packId: 'pack-1', packConfigId: 'cfg-1' }];
			const ops: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { input: { msg: 'hi' } } }];
			const result = applyOperations(tasks as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(result.tasks.find(t => t.name === 'start')!.packOverrides, [
				{ packId: 'pack-1', packConfigId: 'cfg-1' },
			]);
		});

		test('delete_task removes the task and edges pointing at it', () => {
			const ops: WorkflowOperation[] = [{ op: 'delete_task', name: 'end' }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.ok(!tasks.some(t => t.name === 'end'), 'end removed');
			// start's only edge pointed at end and is dropped; it then gets a terminal transition.
			const start = tasks.find(t => t.name === 'start')!;
			assert.strictEqual(start.next!.length, 1, 'start gets a terminal transition after losing its only edge');
			assert.deepStrictEqual(start.next![0].do, []);
			assert.strictEqual(start.next![0].when, '{{ SUCCEEDED }}');
		});

		test('disconnect removes the edge to a target (task keeps a terminal transition)', () => {
			const ops: WorkflowOperation[] = [{ op: 'disconnect', from: 'start', to: 'end' }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			const start = tasks.find(t => t.name === 'start')!;
			assert.strictEqual(start.next!.length, 1);
			assert.deepStrictEqual(start.next![0].do, []);
		});

		test('connect replaces a targetless success fallback with the real success edge', () => {
			const tasksIn = sampleTasks();
			tasksIn[0].next = [{ when: '{{ SUCCEEDED }}', label: '', do: [], publish: [] }];

			const { tasks } = applyOperations(
				tasksIn as never,
				[{ op: 'connect', from: 'start', to: 'end' }],
				NO_ACTIONS,
			);

			const start = tasks.find(t => t.name === 'start')!;
			assert.strictEqual(start.next!.length, 1, 'the redundant terminal fallback is removed');
			assert.strictEqual(start.next![0].when, '{{ SUCCEEDED }}');
			assert.deepStrictEqual(start.next![0].do, ['bb02']);
		});

		test('keeps a targetless success transition that still publishes context', () => {
			// A terminal {{ SUCCEEDED }} edge with do:[] but a real publish list is not
			// a redundant fallback — pruning it would silently drop the published vars.
			const tasksIn = sampleTasks();
			tasksIn[0].next = [
				{ when: '{{ SUCCEEDED }}', label: '', do: ['bb02'], publish: [] },
				{ when: '{{ SUCCEEDED }}', label: '', do: [], publish: [{ key: 'out', value: '{{ 1 }}' }] },
			] as never;

			const { tasks } = applyOperations(
				tasksIn as never,
				[{ op: 'reposition', task: 'end', x: 5, y: 5 }],
				NO_ACTIONS,
			);

			const start = tasks.find(t => t.name === 'start')!;
			assert.strictEqual(start.next!.length, 2, 'the publishing terminal edge is preserved');
			const publishing = start.next!.find(t => (t.do ?? []).length === 0);
			assert.ok(publishing, 'publish-only terminal edge survives');
			assert.strictEqual((publishing!.publish ?? []).length, 1);
		});

		test('set_transition edits the single transition', () => {
			const ops: WorkflowOperation[] = [{ op: 'set_transition', from: 'start', set: { label: 'go' } }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.strictEqual(tasks.find(t => t.name === 'start')!.next![0].label, 'go');
		});

		test('orders a custom condition before the {{ SUCCEEDED }} catch-all on a task', () => {
			// start already has a success transition to end; add a custom-condition
			// edge after it. The success catch-all must end up last so it cannot
			// shadow the custom condition under FOLLOW_FIRST.
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'special', action: 'core.noop' },
				{ op: 'connect', from: 'start', to: 'special', when: '{{ RESULT.flag }}' },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			const start = tasks.find(t => t.name === 'start')!;
			assert.strictEqual(start.next![0].when, '{{ RESULT.flag }}', 'custom condition first');
			assert.strictEqual(start.next![1].when, '{{ SUCCEEDED }}', 'success catch-all last');
		});

		test('treats a blank/whitespace-only condition as a success catch-all when ordering', () => {
			const tasksIn = sampleTasks();
			tasksIn[0].next = [
				{ when: '', label: '', do: ['bb02'], publish: [] },
				{ when: '{{ RESULT.flag }}', label: '', do: ['bb02'], publish: [] },
			];
			const { tasks } = applyOperations(tasksIn as never, [], NO_ACTIONS);
			const start = tasks.find(t => t.name === 'start')!;
			assert.strictEqual(start.next![0].when, '{{ RESULT.flag }}', 'custom condition moves first');
			assert.strictEqual(start.next![1].when, '', 'blank (success) catch-all moves last');
		});

		test('keeps relative order among multiple custom conditions', () => {
			const tasksIn = sampleTasks();
			tasksIn[0].next = [
				{ when: '{{ SUCCEEDED }}', label: '', do: ['bb02'], publish: [] },
				{ when: '{{ RESULT.a }}', label: '', do: ['bb02'], publish: [] },
				{ when: '{{ RESULT.b }}', label: '', do: ['bb02'], publish: [] },
			];
			const { tasks } = applyOperations(tasksIn as never, [], NO_ACTIONS);
			const whens = tasks.find(t => t.name === 'start')!.next!.map(t => t.when);
			assert.deepStrictEqual(whens, ['{{ RESULT.a }}', '{{ RESULT.b }}', '{{ SUCCEEDED }}']);
		});

		test('reposition moves a task to exact (un-snapped) canvas coordinates', () => {
			const ops: WorkflowOperation[] = [{ op: 'reposition', task: 'start', x: 50.5, y: 130 }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(tasks.find(t => t.name === 'start')!.metadata as object, { x: 50.5, y: 130 });
		});

		test('a new connected task is auto-placed one node-height-plus-gap below its parent', () => {
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'notify', action: 'core.noop' },
				{ op: 'connect', from: 'end', to: 'notify' },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			const end = tasks.find(t => t.name === 'end')!.metadata as { x: number; y: number };
			const notify = tasks.find(t => t.name === 'notify')!.metadata as { x: number; y: number };
			assert.strictEqual(notify.x, end.x, 'same column as its parent');
			// NODE_HEIGHT (88) + V_GAP (80) below the parent's top.
			assert.strictEqual(notify.y, end.y + 168, 'placed below its parent with a gap');
		});

		test('add_task honors an explicit position verbatim', () => {
			const ops: WorkflowOperation[] = [{ op: 'add_task', name: 'notify', action: 'core.noop', x: 312, y: 205 }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			assert.deepStrictEqual(tasks.find(t => t.name === 'notify')!.metadata as object, { x: 312, y: 205 });
		});

		test('an unconnected new task drops below the lowest existing node', () => {
			const ops: WorkflowOperation[] = [{ op: 'add_task', name: 'orphan', action: 'core.noop' }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			const orphan = tasks.find(t => t.name === 'orphan')!.metadata as { x: number; y: number };
			// lowest node bottom is end (y=120 + height 88 = 208) + V_GAP (80) = 288.
			assert.strictEqual(orphan.y, 288);
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

	suite('autoLayout()', () => {
		// Node footprint for overlap checks, mirroring the tool's geometry.
		const box = (t: { metadata: unknown; next?: { do?: string[] }[] }) => {
			const m = t.metadata as { x: number; y: number };
			return { x: m.x, y: m.y, w: 209 + 127 * Math.max(1, (t.next ?? []).length), h: 88 };
		};
		const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
			a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

		test('positions every task with finite, non-overlapping coordinates', () => {
			const tasks = sampleTasks();
			autoLayout(tasks as never);
			for (const t of tasks) {
				const m = t.metadata as { x: number; y: number };
				assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y), `${t.name} has finite coordinates`);
			}
			for (let i = 0; i < tasks.length; i++) {
				for (let j = i + 1; j < tasks.length; j++) {
					assert.ok(!overlap(box(tasks[i]), box(tasks[j])), `${tasks[i].name} overlaps ${tasks[j].name}`);
				}
			}
		});

		test('is deterministic for identical input', () => {
			const a = sampleTasks();
			const b = sampleTasks();
			autoLayout(a as never);
			autoLayout(b as never);
			assert.deepStrictEqual(
				a.map(t => t.metadata),
				b.map(t => t.metadata),
			);
		});

		test('handles a cycle without runaway coordinates', () => {
			const cyclic = sampleTasks();
			cyclic[1].next = [{ when: '{{ SUCCEEDED }}', label: '', do: ['aa01'], publish: [] }]; // end -> start
			autoLayout(cyclic as never);
			for (const t of cyclic) {
				const m = t.metadata as { x: number; y: number };
				assert.ok(Math.abs(m.x) < 100000 && Math.abs(m.y) < 100000, `${t.name} stays bounded`);
			}
		});

		test('orders a rank by transition order and floats a loop node to its target rank', () => {
			// start -> executions -> can_proceed -> {drop, maxretry, delay, noop_end};
			// delay loops back to executions.
			const node = (id: string, dos: string[][] = []) => ({
				id,
				name: id,
				actionId: 'noop-id',
				action: { ref: 'core.noop' },
				input: {},
				metadata: {} as { x: number; y: number },
				next: dos.map(d => ({ when: '{{ SUCCEEDED }}', label: '', do: d, publish: [] })),
			});
			const tasks = [
				node('start', [['executions']]),
				node('executions', [['can_proceed']]),
				node('can_proceed', [['drop'], ['maxretry'], ['delay'], ['noop_end']]),
				node('drop'),
				node('maxretry'),
				node('delay', [['executions']]),
				node('noop_end'),
			];
			autoLayout(tasks as never);
			const pos = Object.fromEntries(tasks.map(t => [t.id, t.metadata as { x: number; y: number }]));

			// The loop node shares its target's rank, not the exit row below can_proceed.
			assert.strictEqual(pos.delay.y, pos.executions.y, 'delay floats to executions row');
			assert.ok(pos.delay.y < pos.drop.y, 'delay is above the exit row');

			// can_proceed's non-loop children share one rank, ordered by transition order.
			assert.strictEqual(pos.drop.y, pos.maxretry.y);
			assert.strictEqual(pos.maxretry.y, pos.noop_end.y);
			assert.ok(pos.drop.x < pos.maxretry.x, 'drop (transition 0) left of maxretry (transition 1)');
			assert.ok(pos.maxretry.x < pos.noop_end.x, 'maxretry left of noop_end (later transition)');
		});

		test('routes a terminal catch fed by many ranks into the right lane', () => {
			const node = (id: string, dos: string[][] = []) => ({
				id,
				name: id,
				actionId: 'noop-id',
				action: { ref: 'core.noop' },
				input: {},
				metadata: {} as { x: number; y: number },
				next: dos.map(d => ({ when: '{{ SUCCEEDED }}', label: '', do: d, publish: [] })),
			});
			// A 7-node chain n0..n6; n0,n2,n4,n6 also feed a shared "catch" -> end.
			const tasks = [
				node('n0', [['n1'], ['catch']]),
				node('n1', [['n2']]),
				node('n2', [['n3'], ['catch']]),
				node('n3', [['n4']]),
				node('n4', [['n5'], ['catch']]),
				node('n5', [['n6']]),
				node('n6', [['end'], ['catch']]),
				node('catch', [['end']]),
				node('end'),
			];
			autoLayout(tasks as never);
			const pos = Object.fromEntries(tasks.map(t => [t.id, t.metadata as { x: number; y: number }]));
			const mainMaxX = Math.max(...['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'end'].map(id => pos[id].x));
			assert.ok(pos.catch.x > mainMaxX, 'the catch is in a lane to the right of the whole main flow');
			// end is fed by only 2 (n6 + catch), so it stays in the main column, not the lane.
			assert.ok(pos.end.x <= mainMaxX, 'the natural end node stays in the main flow');
		});

		test('the autolayout operation recomputes positions from a messy layout', () => {
			const messy = sampleTasks();
			messy[0].metadata = { x: 9999, y: -9999 };
			const { tasks, applied } = applyOperations(messy as never, [{ op: 'autolayout' }], NO_ACTIONS);
			const start = tasks.find(t => t.name === 'start')!.metadata as { x: number; y: number };
			assert.notDeepStrictEqual(start, { x: 9999, y: -9999 }, 'the stale position was replaced');
			assert.ok(Number.isFinite(start.x) && Number.isFinite(start.y));
			assert.match(applied[0], /autolayout/);
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
				workflowEditScope('buddy_graphql', { workflowId: 'a', workflowName: 'b', orgId: 'c', orgName: 'd' }),
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

		test('the autolayout tool shares the per-workflow scope and prompt', () => {
			const args = { workflowId: 'wf-1', workflowName: 'WF', orgId: 'org-1', orgName: 'Acme' };
			assert.deepStrictEqual(workflowEditScope(WORKFLOW_AUTOLAYOUT_TOOL_NAME, args), {
				scopeId: 'wf-1',
				scopeName: 'WF',
				orgId: 'org-1',
				orgName: 'Acme',
			});
			const confirmation = workflowEditConfirmation(WORKFLOW_AUTOLAYOUT_TOOL_NAME, args);
			assert.ok(confirmation);
			assert.match(confirmation!.message, /Auto-layout/);
			assert.match(confirmation!.message, /re-arranges every task/i);
		});
	});

	suite('runWorkflowTool()', () => {
		// A deps.execute that routes by operation name and records calls.
		function makeDeps(
			over: Partial<{
				updateResults: { data?: unknown; errors?: unknown }[];
				pollStatus: string;
				pollError: string;
				renderResult: unknown;
				contexts: Record<string, unknown>[];
				taskLogs: unknown[];
				executions: unknown[];
				indexWorkflows: { id: string; name: string; orgId: string; orgName: string }[];
			}> = {},
		) {
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
				if (query.includes('RewstBuddyExecutionContexts')) {
					return {
						data: { workflowExecutionContexts: over.contexts ?? [{ proceed: false }, { proceed: true }] },
					};
				}
				if (query.includes('RewstBuddyRenderJinja')) {
					// Echo the context value the tool passed, to prove it rendered against it.
					const vars = variables?.vars as { proceed?: unknown } | undefined;
					return { data: { renderJinja: { result: over.renderResult ?? vars?.proceed } } };
				}
				if (query.includes('RewstBuddyTestWorkflow')) {
					return { data: { testWorkflow: { executionId: 'exec-new' } } };
				}
				if (query.includes('RewstBuddyExecutions')) {
					const where = (variables?.where ?? {}) as { id?: string; workflowId?: string };
					// where.id => run-and-wait poll for a single execution's status.
					if (where.id) {
						if (over.pollError) return { errors: [{ message: over.pollError }] };
						return {
							data: { workflowExecutions: [{ id: where.id, status: over.pollStatus ?? 'failed' }] },
						};
					}
					return {
						data: {
							workflowExecutions: over.executions ?? [
								{ id: 'ex-2', status: 'failed', createdAt: '2000', numSuccessfulTasks: 1 },
								{ id: 'ex-1', status: 'failed', createdAt: '1000', numSuccessfulTasks: 2 },
							],
						},
					};
				}
				if (query.includes('RewstBuddyTaskLogs')) {
					return { data: { taskLogs: over.taskLogs ?? [] } };
				}
				if (query.includes('RewstBuddyWorkflowsIndex')) {
					const all = over.indexWorkflows ?? [
						{ id: 'wf-aaa', name: 'Onboarding', orgId: 'org-1', orgName: 'Primary Org' },
						{ id: 'wf-bbb', name: 'Offboarding', orgId: 'org-1', orgName: 'Primary Org' },
						{ id: 'wf-ccc', name: 'Acme Onboarding', orgId: 'org-2', orgName: 'Acme Corp' },
					];
					const offset = (variables?.offset as number | undefined) ?? 0;
					const limit = (variables?.limit as number | undefined) ?? all.length;
					const page = all.slice(offset, offset + limit).map(w => ({
						id: w.id,
						name: w.name,
						orgId: w.orgId,
						organization: { id: w.orgId, name: w.orgName },
					}));
					return { data: { workflows: page } };
				}
				return { data: {} };
			};
			const deps: GraphqlToolDeps = { isEnabled: () => true, confirmMutation: async () => true, execute };
			return { deps, calls };
		}

		test('buddy_workflow_get returns a concise analysis graph by default (no ids/positions)', async () => {
			const { deps } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'buddy_workflow_get', args: { workflowId: 'wf-1', orgId: 'org-1' } },
				deps,
			);
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.workflow.name, 'Sample');
			assert.strictEqual(parsed.workflow.orgName, 'Test Org', 'org name is surfaced for the edit/approval args');
			assert.strictEqual(parsed.workflow.id, 'wf-1', 'workflow id is kept (needed for follow-up calls)');
			assert.ok(!('versionToken' in parsed.workflow), 'version token omitted in the analysis view');
			assert.deepStrictEqual(
				parsed.workflow.inputs,
				[{ name: 'email', type: 'string', title: 'Email', required: true, description: 'addr' }],
				'inputs are surfaced from action.parameters',
			);
			assert.strictEqual(parsed.nodes.length, 2);
			assert.ok(!('id' in parsed.nodes[0]), 'task ids omitted in the analysis view');
			assert.ok(!('position' in parsed.nodes[0]), 'canvas position omitted in the analysis view');
			assert.strictEqual(parsed.edges[0].from, 'start');
			assert.deepStrictEqual(parsed.edges[0].to, ['end'], 'targets referenced by name, no id');
			assert.ok(!('transitionId' in parsed.edges[0]), 'transition ids omitted in the analysis view');
		});

		test('buddy_workflow_get with detail "full" restores ids, positions, and the version token', async () => {
			const { deps } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'buddy_workflow_get', args: { workflowId: 'wf-1', orgId: 'org-1', detail: 'full' } },
				deps,
			);
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.workflow.versionToken, '1000', 'version token present in full view');
			assert.strictEqual(parsed.nodes[0].id, 'aa01', 'task id present in full view');
			assert.deepStrictEqual(parsed.nodes[0].position, { x: 0, y: 0 }, 'position present in full view');
			assert.deepStrictEqual(parsed.edges[0].to, ['end (bb02)'], 'targets carry the id in full view');
		});

		test('buddy_workflow_get surfaces workflow outputs, the sub-workflow return contract', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'buddy_workflow_get', args: { workflowId: 'wf-1', orgId: 'org-1' } },
				deps,
			);
			const getCall = calls.find(c => c.query.includes('RewstBuddyWorkflowGet'));
			assert.ok(getCall && /\boutput\b/.test(getCall.query), 'the read query selects the output field');
			const parsed = JSON.parse(output);
			assert.deepStrictEqual(
				parsed.workflow.outputs,
				[{ name: 'user_found', value: '{{ CTX.user_found|d(false) }}' }],
				'outputs are surfaced as name/value pairs in the workflow header',
			);
			assert.match(parsed.note, /set_output/, 'the note points at set_output for changing the contract');
		});

		test('buddy_workflow_get hides task mode and join criteria', async () => {
			const task = (over: Record<string, unknown>) => ({
				id: String(over.name),
				actionId: 'x',
				action: { ref: 'core.noop' },
				next: [],
				...over,
			});
			const execute: GraphqlToolDeps['execute'] = async query => {
				if (query.includes('RewstBuddyWorkflowGet')) {
					return {
						data: {
							workflow: {
								id: 'wf-1',
								name: 'Sample',
								orgId: 'org-1',
								organization: { id: 'org-1', name: 'Test Org' },
								input: [],
								action: { parameters: {} },
								updatedAt: '1000',
								tasks: [
									task({ name: 'fanout', transitionMode: 'FOLLOW_ALL', join: 1 }),
									task({ name: 'merge', transitionMode: 'FOLLOW_FIRST', join: 0 }),
									task({ name: 'plain', transitionMode: 'FOLLOW_FIRST', join: 1 }),
								],
							},
						},
					};
				}
				return { data: {} };
			};
			const deps: GraphqlToolDeps = { isEnabled: () => true, confirmMutation: async () => true, execute };
			const parsed = JSON.parse(
				await runWorkflowTool(
					{ tool: 'buddy_workflow_get', args: { workflowId: 'wf-1', orgId: 'org-1' } },
					deps,
				),
			);
			const byName = (n: string) => parsed.nodes.find((x: { name: string }) => x.name === n);
			for (const name of ['fanout', 'merge', 'plain']) {
				assert.ok(!('transitionMode' in byName(name)), `${name} hides transitionMode`);
				assert.ok(!('join' in byName(name)), `${name} hides join`);
			}
		});

		test('buddy_action_search returns ranked matches', async () => {
			const { deps } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'buddy_action_search', args: { orgId: 'org-1', query: 'noop' } },
				deps,
			);
			assert.match(output, /core\.noop/);
		});

		test('buddy_action_search steers a run-workflow query to the sub-workflow pattern', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'buddy_action_search', args: { orgId: 'org-1', query: 'run workflow' } },
				deps,
			);
			assert.match(output, /sub-workflow|subWorkflowId/i);
			assert.strictEqual(calls.length, 0, 'short-circuits without hitting the API');
		});

		test('buddy_render_jinja renders against an execution (merged snapshots) and returns only the result', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: 'buddy_render_jinja',
					args: { orgId: 'org-1', executionId: 'exec-1', template: '{{ CTX.proceed }}' },
				},
				deps,
			);
			// Mock has snapshots [{proceed:false},{proceed:true}]; the merge keeps the latest value.
			assert.match(output, /Rendered: true \(type boolean\)/);
			assert.ok(
				calls.some(c => c.query.includes('RewstBuddyExecutionContexts')),
				'fetched the execution context server-side',
			);
		});

		test('buddy_render_jinja merges all delta snapshots by default', async () => {
			// Execution context snapshots are per-publish DELTAS: the initial frame
			// holds the run inputs, later frames only the keys each publish wrote.
			// The default context must be the in-order merge of all of them.
			const { deps, calls } = makeDeps({
				contexts: [{ user_upn: 'a@b.c', mode: 'review' }, { ticket_id: '43' }, { automation_log: ['x'] }],
			});
			await runWorkflowTool(
				{
					tool: 'buddy_render_jinja',
					args: { orgId: 'org-1', executionId: 'exec-1', template: '{{ CTX.user_upn }}' },
				},
				deps,
			);
			const render = calls.find(c => c.query.includes('RewstBuddyRenderJinja'))!;
			assert.deepStrictEqual(
				render.variables!.vars,
				{ user_upn: 'a@b.c', mode: 'review', ticket_id: '43', automation_log: ['x'] },
				'the render context is the cumulative merge, so early-frame keys stay visible',
			);
		});

		test('buddy_render_jinja honors contextIndex as one raw delta, without merging', async () => {
			const { deps, calls } = makeDeps({
				contexts: [{ proceed: false, initial: true }, { proceed: true }],
			});
			const output = await runWorkflowTool(
				{
					tool: 'buddy_render_jinja',
					args: { orgId: 'org-1', executionId: 'exec-1', template: '{{ CTX.proceed }}', contextIndex: 0 },
				},
				deps,
			);
			assert.match(output, /Rendered: false/);
			const render = calls.find(c => c.query.includes('RewstBuddyRenderJinja'))!;
			assert.deepStrictEqual(
				render.variables!.vars,
				{ proceed: false, initial: true },
				'contextIndex selects the raw snapshot as-is',
			);
		});

		test('buddy_render_jinja keys mode reports how many snapshots were merged', async () => {
			const { deps } = makeDeps({
				contexts: [{ a: 1 }, { b: 2 }, { a: 3 }],
			});
			const output = await runWorkflowTool(
				{ tool: 'buddy_render_jinja', args: { orgId: 'org-1', executionId: 'exec-1', keys: true } },
				deps,
			);
			assert.match(output, /Context top-level keys \(2\): a, b/);
			assert.match(output, /merged from 3 snapshot/i);
		});

		test('buddy_render_jinja spec describes snapshots as merged deltas', () => {
			const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === 'buddy_render_jinja');
			assert.ok(spec, 'buddy_render_jinja spec exists');
			assert.match(spec.description, /per-publish deltas/i);
			assert.match(spec.description, /merges/i);
			assert.doesNotMatch(spec.description, /the last context snapshot of the run is used/i);
			const contextIndex = (spec.inputSchema as { properties: { contextIndex: { description: string } } })
				.properties.contextIndex;
			assert.match(contextIndex.description, /raw|single/i);
			assert.doesNotMatch(contextIndex.description, /most-complete/i);
		});

		test('buddy_render_jinja renders ad-hoc vars without an execution', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: 'buddy_render_jinja',
					args: { orgId: 'org-1', vars: { proceed: true }, template: '{{ CTX.proceed }}' },
				},
				deps,
			);
			assert.match(output, /Rendered: true/);
			assert.ok(
				!calls.some(c => c.query.includes('RewstBuddyExecutionContexts')),
				'no execution fetch for ad-hoc vars',
			);
		});

		test('buddy_render_jinja returns oversized values intact for the shared tool-output formatter', async () => {
			const longValue = 'x'.repeat(8_100);
			const { deps } = makeDeps({ renderResult: longValue });
			const output = await runWorkflowTool(
				{
					tool: 'buddy_render_jinja',
					args: { orgId: 'org-1', vars: {}, template: '{{ CTX() }}' },
				},
				deps,
			);
			assert.ok(output.includes(longValue), 'full rendered value is present');
			assert.doesNotMatch(output, /output truncated/);
		});

		test('buddy_render_jinja requires an execution or vars', async () => {
			const { deps } = makeDeps();
			await assert.rejects(
				() =>
					runWorkflowTool(
						{ tool: 'buddy_render_jinja', args: { orgId: 'org-1', template: '{{ 1 }}' } },
						deps,
					),
				/executionId.*vars|vars/,
			);
		});

		test('buddy_workflow_edit applies ops and reports the new version token', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
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

		test('buddy_workflow_edit warns when the server did not store an input as sent', async () => {
			// The Rewst API filters task input against the action's inputSchema and
			// reports success anyway; the tool must catch the drop by re-reading.
			let gets = 0;
			const calls: { query: string }[] = [];
			const execute: GraphqlToolDeps['execute'] = async query => {
				calls.push({ query });
				if (query.includes('RewstBuddyWorkflowGet')) {
					gets += 1;
					const w = sampleWorkflow();
					if (gets > 1) {
						// The verification read: the nested key was silently stripped.
						(w.tasks[0] as Record<string, unknown>).input = { json_body: { status: {} } };
					}
					return { data: { workflow: w } };
				}
				if (query.includes('RewstBuddyWorkflowUpdate')) {
					return { data: { updateWorkflow: { id: 'wf-1', updatedAt: '2000' } } };
				}
				return { data: {} };
			};
			const deps: GraphqlToolDeps = { isEnabled: () => true, confirmMutation: async () => true, execute };
			const output = await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
					args: {
						workflowId: 'wf-1',
						workflowName: 'Sample',
						orgId: 'org-1',
						orgName: 'Acme',
						operations: [
							{
								op: 'update_task',
								name: 'start',
								set: { input: { json_body: { status: { name: 'In Progress' } } } },
							},
						],
					},
				},
				deps,
			);
			assert.strictEqual(gets, 2, 'the save is verified with a re-read');
			assert.match(output, /Applied 1 operation/, 'the edit still reports what was applied');
			assert.match(output, /WARNING — the server did not store/i);
			assert.match(output, /task "start": input\.json_body\.status\.name/);
			assert.match(output, /inputSchema/, 'explains why the server dropped the key');
		});

		test('buddy_workflow_edit skips the verification read when no operation carries input', async () => {
			const { deps, calls } = makeDeps();
			await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
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
			const gets = calls.filter(c => c.query.includes('RewstBuddyWorkflowGet'));
			assert.strictEqual(gets.length, 1, 'no verification read for a graph-only edit');
		});

		test('buddy_workflow_edit notes a failed verification read without failing the edit', async () => {
			let gets = 0;
			const execute: GraphqlToolDeps['execute'] = async query => {
				if (query.includes('RewstBuddyWorkflowGet')) {
					gets += 1;
					if (gets > 1) return { errors: [{ message: 'read timed out' }] };
					return { data: { workflow: sampleWorkflow() } };
				}
				if (query.includes('RewstBuddyWorkflowUpdate')) {
					return { data: { updateWorkflow: { id: 'wf-1', updatedAt: '2000' } } };
				}
				return { data: {} };
			};
			const deps: GraphqlToolDeps = { isEnabled: () => true, confirmMutation: async () => true, execute };
			const output = await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
					args: {
						workflowId: 'wf-1',
						workflowName: 'Sample',
						orgId: 'org-1',
						orgName: 'Acme',
						operations: [{ op: 'update_task', name: 'start', set: { input: { params: { text: 'x' } } } }],
					},
				},
				deps,
			);
			assert.match(output, /Applied 1 operation/, 'the edit itself succeeded');
			assert.match(output, /could not verify/i);
		});

		test('buddy_workflow_edit retries once on a version conflict with the fresh token', async () => {
			const { deps, calls } = makeDeps({
				updateResults: [
					{ errors: [{ message: 'A newer version of this workflow exists.' }] },
					{ data: { updateWorkflow: { id: 'wf-1', updatedAt: '3000' } } },
				],
			});
			const output = await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
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

		test('buddy_workflow_edit aborts without saving when the mutation is not confirmed', async () => {
			const { deps, calls } = makeDeps();
			const declining: GraphqlToolDeps = { ...deps, confirmMutation: async () => false };
			await assert.rejects(
				() =>
					runWorkflowTool(
						{
							tool: 'buddy_workflow_edit',
							args: {
								workflowId: 'wf-1',
								workflowName: 'Sample',
								orgId: 'org-1',
								orgName: 'Acme',
								operations: [{ op: 'add_task', name: 'x', action: 'core.noop' }],
							},
						},
						declining,
					),
				/not confirmed/,
			);
			assert.ok(!calls.some(c => c.query.includes('RewstBuddyWorkflowUpdate')), 'no save when declined');
		});

		test('buddy_workflow_autolayout re-arranges and saves', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_AUTOLAYOUT_TOOL_NAME,
					args: { workflowId: 'wf-1', workflowName: 'Sample', orgId: 'org-1', orgName: 'Acme' },
				},
				deps,
			);
			assert.match(output, /autolayout/);
			assert.match(output, /2000/);
			assert.ok(
				calls.some(c => c.query.includes('RewstBuddyWorkflowUpdate')),
				'it saved',
			);
		});

		test('buddy_workflow_executions lists failed runs newest-first and passes the status filter', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'buddy_workflow_executions', args: { workflowId: 'wf-1', orgId: 'org-1', status: 'failed' } },
				deps,
			);
			assert.match(output, /ex-2/);
			assert.match(output, /ex-1/);
			assert.match(output, /failed/);
			const call = calls.find(c => c.query.includes('RewstBuddyExecutions'))!;
			assert.deepStrictEqual(
				call.variables!.where,
				{ workflowId: 'wf-1', orgId: 'org-1', status: 'failed' },
				'default (root-only) keeps the org filter so only top-level runs return',
			);
			assert.deepStrictEqual(call.variables!.order, [['createdAt', 'desc']], 'requests newest-first');
		});

		test('buddy_workflow_executions rootOnly:false searches by workflow id without the org root filter', async () => {
			const { deps, calls } = makeDeps({
				executions: [
					{
						id: 'sub-ex-1',
						status: 'succeeded',
						createdAt: '3000',
						numSuccessfulTasks: 5,
						orgId: 'org-2',
						parentExecutionId: 'parent-ex-1',
						originatingExecutionId: 'root-ex-1',
					},
				],
			});
			const output = await runWorkflowTool(
				{
					tool: 'buddy_workflow_executions',
					args: { workflowId: 'wf-sub', orgId: 'org-1', rootOnly: false },
				},
				deps,
			);

			assert.match(output, /sub-ex-1/);
			assert.match(output, /org org-2/, 'renders the execution org so cross-org sub-runs are visible');
			assert.match(output, /parent parent-ex-1/);
			assert.match(output, /root root-ex-1/, 'renders the originating (root) execution link');
			const call = calls.find(c => c.query.includes('RewstBuddyExecutions'))!;
			assert.deepStrictEqual(call.variables!.where, { workflowId: 'wf-sub' });
		});

		test('buddy_workflow_executions coerces the string "false" rootOnly to the sub-workflow search', async () => {
			const { deps, calls } = makeDeps({
				executions: [{ id: 'sub-ex-1', status: 'succeeded', createdAt: '3000', parentExecutionId: 'p-1' }],
			});
			const output = await runWorkflowTool(
				{
					tool: 'buddy_workflow_executions',
					args: { workflowId: 'wf-sub', orgId: 'org-1', rootOnly: 'false' },
				},
				deps,
			);

			assert.match(output, /sub-ex-1/);
			const call = calls.find(c => c.query.includes('RewstBuddyExecutions'))!;
			assert.deepStrictEqual(
				call.variables!.where,
				{ workflowId: 'wf-sub' },
				'the string "false" must not slip through as the default root-only filter',
			);
		});

		test('buddy_workflow_executions empty root-only results mention sub-workflow search', async () => {
			const { deps } = makeDeps({ executions: [] });
			const output = await runWorkflowTool(
				{ tool: 'buddy_workflow_executions', args: { workflowId: 'wf-sub', orgId: 'org-1' } },
				deps,
			);

			assert.match(output, /No recent root-level executions/);
			assert.match(output, /rootOnly:false/);
		});

		test('buddy_workflow_executions empty rootOnly:false results give the plain message, not the sub-workflow hint', async () => {
			const { deps } = makeDeps({ executions: [] });
			const output = await runWorkflowTool(
				{ tool: 'buddy_workflow_executions', args: { workflowId: 'wf-sub', orgId: 'org-1', rootOnly: false } },
				deps,
			);

			assert.match(output, /No recent executions for workflow wf-sub/);
			assert.doesNotMatch(output, /rootOnly:false/, 'no point suggesting the search the caller already ran');
		});

		test('buddy_workflow_run with wait:false returns the execution id without polling', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_RUN_TOOL_NAME,
					args: {
						workflowId: 'wf-1',
						workflowName: 'Sample',
						orgId: 'org-1',
						orgName: 'Acme',
						input: { email: 'x@y.z' },
						wait: false,
					},
				},
				deps,
			);
			assert.match(output, /exec-new/, 'returns the execution id');
			const call = calls.find(c => c.query.includes('RewstBuddyTestWorkflow'))!;
			assert.deepStrictEqual(call.variables!.input, { email: 'x@y.z' }, 'passes the run input through');
			assert.ok(!calls.some(c => c.query.includes('RewstBuddyExecutions')), 'wait:false does not poll');
		});

		test('buddy_workflow_run waits and surfaces the failing task on a failed run', async () => {
			const { deps, calls } = makeDeps({
				pollStatus: 'failed',
				taskLogs: [
					{
						originalWorkflowTaskName: 'executions',
						status: 'failed',
						message: 'invalid input syntax for type uuid: ""',
						input: { where: { orgId: '', workflowId: '' } },
						result: null,
					},
					{ originalWorkflowTaskName: 'start', status: 'succeeded', result: { ok: true } },
				],
			});
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_RUN_TOOL_NAME,
					args: { workflowId: 'wf-1', workflowName: 'Sample', orgId: 'org-1', orgName: 'Acme' },
				},
				deps,
			);
			assert.match(output, /FAILED/, 'reports the failed outcome');
			assert.match(output, /executions: failed/, 'names the failing task');
			assert.match(output, /invalid input syntax/, 'surfaces the failure message');
			assert.match(output, /orgId/, 'surfaces the input the task received');
			assert.ok(
				calls.some(c => c.query.includes('RewstBuddyExecutions')),
				'polled for status',
			);
			assert.ok(
				calls.some(c => c.query.includes('RewstBuddyTaskLogs')),
				'fetched task logs',
			);
		});

		test('buddy_workflow_run waits and reports success without fetching logs', async () => {
			const { deps, calls } = makeDeps({ pollStatus: 'succeeded' });
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_RUN_TOOL_NAME,
					args: { workflowId: 'wf-1', workflowName: 'Sample', orgId: 'org-1', orgName: 'Acme' },
				},
				deps,
			);
			assert.match(output, /SUCCEEDED/);
			assert.ok(!calls.some(c => c.query.includes('RewstBuddyTaskLogs')), 'no log fetch on success');
		});

		test('buddy_workflow_run surfaces a polling error instead of looping to the timeout', async () => {
			const { deps } = makeDeps({ pollError: 'permission denied' });
			await assert.rejects(
				() =>
					runWorkflowTool(
						{
							tool: WORKFLOW_RUN_TOOL_NAME,
							args: { workflowId: 'wf-1', workflowName: 'Sample', orgId: 'org-1', orgName: 'Acme' },
						},
						deps,
					),
				/Failed to poll.*permission denied/,
			);
		});

		test('buddy_execution_logs summarizes tasks and details failed ones', async () => {
			const { deps } = makeDeps({
				taskLogs: [
					{
						originalWorkflowTaskName: 'executions',
						status: 'failed',
						message: 'boom',
						input: { x: '' },
						result: { e: 1 },
					},
					{ originalWorkflowTaskName: 'start', status: 'succeeded', result: { ok: true } },
				],
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /2 task\(s\), 1 failed/);
			assert.match(output, /executions: failed/);
			assert.match(output, /message: boom/);
			assert.match(output, /input:/, 'failed task shows the input it received');
			assert.match(output, /start: succeeded/);
			assert.ok(!output.includes('"ok":true'), "succeeded task's result is hidden by default");
		});

		test('buddy_execution_logs sweeps alternate sessions when the primary sees no rows', async () => {
			// An execution in another account's org hierarchy returns zero rows on
			// the primary session; the tool must try the other active sessions
			// (issue #116). The first alternate here errors and must be skipped.
			const depsFor = (taskLogs: unknown): GraphqlToolDeps => ({
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async query =>
					query.includes('RewstBuddyTaskLogs')
						? (taskLogs as { data?: unknown; errors?: unknown })
						: { data: {} },
			});
			const deps = depsFor({ data: { taskLogs: [] } });
			deps.alternates = [
				depsFor({ errors: [{ message: 'no access' }] }),
				depsFor({
					data: { taskLogs: [{ originalWorkflowTaskName: 'do_thing', status: 'succeeded' }] },
				}),
			];
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-9' } },
				deps,
			);
			assert.match(output, /1 task\(s\), 0 failed/);
			assert.match(output, /do_thing: succeeded/);
			assert.match(output, /another active session/i);
		});

		test('buddy_execution_logs explains visibility when no session has rows', async () => {
			const empty = (): GraphqlToolDeps => ({
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async () => ({ data: { taskLogs: [] } }),
			});
			const deps = empty();
			deps.alternates = [empty()];
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-9' } },
				deps,
			);
			assert.match(output, /0 task\(s\)/);
			assert.match(output, /none of the \d+ active session/i);
		});

		test('buddy_execution_logs spec accepts an optional orgId for session routing', () => {
			const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EXECUTION_LOGS_TOOL_NAME);
			assert.ok(spec, 'buddy_execution_logs spec exists');
			assert.match(spec.args, /"orgId"\?/);
			const orgId = (spec.inputSchema as { properties: Record<string, { description?: string }> }).properties
				.orgId;
			assert.ok(orgId, 'inputSchema declares orgId');
			assert.match(orgId.description ?? '', /session|account/i);
			assert.ok(
				!(spec.inputSchema as { required?: string[] }).required?.includes('orgId'),
				'orgId stays optional',
			);
		});

		test('buddy_execution_logs failedOnly lists only failed tasks', async () => {
			const { deps } = makeDeps({
				taskLogs: [
					{ originalWorkflowTaskName: 'executions', status: 'failed', message: 'boom' },
					{ originalWorkflowTaskName: 'start', status: 'succeeded' },
				],
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1', failedOnly: true } },
				deps,
			);
			assert.match(output, /executions: failed/);
			assert.ok(!output.includes('start: succeeded'), 'omits non-failed tasks');
		});

		test('buddy_execution_logs includeResult shows every task result', async () => {
			const { deps } = makeDeps({
				taskLogs: [{ originalWorkflowTaskName: 'start', status: 'succeeded', result: { ok: true } }],
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1', includeResult: true } },
				deps,
			);
			assert.match(output, /start: succeeded/);
			assert.match(output, /"ok":true/);
		});

		test('buddy_execution_logs requires an executionId', async () => {
			const { deps } = makeDeps();
			await assert.rejects(
				() => runWorkflowTool({ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: {} }, deps),
				/executionId/,
			);
		});

		test('buddy_workflow_search indexes every accessible org and shows the org name', async () => {
			const { deps } = makeDeps();
			const out = await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'onboarding' } }, deps);
			assert.match(out, /Onboarding {2}\(id: wf-aaa\) {2}org: Primary Org \(org-1\)/);
			assert.match(out, /Acme Onboarding {2}\(id: wf-ccc\) {2}org: Acme Corp \(org-2\)/);
			assert.ok(!out.includes('Offboarding'), 'only the matching workflows are listed');
			assert.match(out, /across 2 org/, 'reports how many orgs were indexed');
		});

		test('buddy_workflow_search ranks an exact name match first', async () => {
			const { deps } = makeDeps();
			const out = await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'onboarding' } }, deps);
			// "Onboarding" (exact) must sort before "Acme Onboarding" (contains).
			assert.ok(out.indexOf('wf-aaa') < out.indexOf('wf-ccc'), 'exact match ranked first');
		});

		test('buddy_workflow_search caches the index and reuses it for the same full query', async () => {
			const { deps, calls } = makeDeps();
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'off', orgId: 'org-1' } }, deps);
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'off', orgId: 'org-1' } }, deps);
			const indexCalls = calls.filter(c => c.query.includes('RewstBuddyWorkflowsIndex')).length;
			assert.strictEqual(indexCalls, 1, 'the workflow list was fetched once for the identical search request');
		});

		test('buddy_workflow_search refresh rebuilds the index', async () => {
			const { deps, calls } = makeDeps();
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: {} }, deps);
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { refresh: true } }, deps);
			const indexCalls = calls.filter(c => c.query.includes('RewstBuddyWorkflowsIndex')).length;
			assert.strictEqual(indexCalls, 2, 'refresh re-listed the workflows');
		});

		test('buddy_workflow_search rebuilds when the session (deps.cacheScope) changes', async () => {
			const { deps, calls } = makeDeps();
			const depsA = { ...deps, cacheScope: 'org-A' };
			const depsB = { ...deps, cacheScope: 'org-B' };
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: {} }, depsA); // build for A
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: {} }, depsA); // reuse A
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: {} }, depsB); // switch -> rebuild
			const indexCalls = calls.filter(c => c.query.includes('RewstBuddyWorkflowsIndex')).length;
			assert.strictEqual(indexCalls, 2, 'reused within a session, rebuilt when the session changed');
		});

		test('buddy_workflow_search reuses the cached index across different full queries in the same session', async () => {
			const { deps, calls } = makeDeps();
			// The index spans every org; orgId/query only filter the cached entries, so a
			// different filter must reuse the index, not re-list every workflow again.
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { orgId: 'org-1' } }, deps);
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { orgId: 'org-2' } }, deps);

			const indexCalls = calls.filter(c => c.query.includes('RewstBuddyWorkflowsIndex')).length;
			assert.strictEqual(indexCalls, 1, 'a different filter reuses the all-orgs index');
		});

		test('buddy_workflow_search refresh rebuilds the shared index for later distinct queries too', async () => {
			const { deps, calls } = makeDeps();
			// refresh must invalidate the one shared index, not just the current query's
			// entry — otherwise a later distinct query keeps returning the stale index
			// that omits a newly created workflow.
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { orgId: 'org-1' } }, deps);
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { refresh: true } }, deps);
			await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { orgId: 'org-2' } }, deps);

			const indexCalls = calls.filter(c => c.query.includes('RewstBuddyWorkflowsIndex')).length;
			assert.strictEqual(
				indexCalls,
				2,
				'refresh rebuilt the shared index once; the later query reused the rebuild',
			);
		});

		test('buddy_workflow_search builds the index once no matter how many distinct queries run', async () => {
			const { deps, calls } = makeDeps();
			// The cache is keyed by session scope, not by the query, so many distinct
			// searches share one index build instead of re-listing every workflow each
			// time (and never accumulate a per-query cache entry).
			for (let i = 0; i < 10; i++) {
				await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: `query-${i}` } }, deps);
			}

			const indexCalls = calls.filter(c => c.query.includes('RewstBuddyWorkflowsIndex')).length;
			assert.strictEqual(indexCalls, 1, 'ten distinct queries reused the one cached all-orgs index');
		});

		test('buddy_workflow_search scopes to a single org with orgId', async () => {
			const { deps } = makeDeps();
			const out = await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { orgId: 'org-2' } }, deps);
			assert.match(out, /Acme Onboarding/);
			assert.ok(!out.includes('wf-aaa'), 'org-1 workflows excluded');
		});

		test('buddy_workflow_search reports a clean no-match message', async () => {
			const { deps } = makeDeps();
			const out = await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'zzz-nope' } }, deps);
			assert.match(out, /No matches/);
			assert.match(out, /refresh:true/, 'suggests refresh for a newly created workflow');
		});

		test('buddy_workflow_search matches across punctuation and word order', async () => {
			const { deps } = makeDeps({
				indexWorkflows: [
					{ id: 'wf-js', name: "Jon's Sandbox", orgId: 'org-1', orgName: 'Test Org' },
					{ id: 'wf-lock', name: '[RAVEN] Workflow Lock', orgId: 'org-1', orgName: 'Test Org' },
				],
			});
			// Apostrophe in the name must not block the match.
			const a = await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'jon sandbox' } }, deps);
			assert.match(
				a,
				/Jon's Sandbox {2}\(id: wf-js\)/,
				"apostrophe-insensitive: 'jon sandbox' finds Jon's Sandbox",
			);
			// Reversed word order + a bracket prefix must still match.
			const b = await runWorkflowTool(
				{ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'lock workflow' } },
				deps,
			);
			assert.match(b, /\[RAVEN\] Workflow Lock {2}\(id: wf-lock\)/, 'word-order/bracket-insensitive');
		});

		test('buddy_workflow_search summarizes org-name matches instead of flooding the list', async () => {
			const wfs = [{ id: 'wf-named', name: "Jon's Sandbox", orgId: 'org-x', orgName: 'Test Org' }];
			for (let i = 0; i < 20; i++) {
				wfs.push({ id: `wf-in-${i}`, name: `Unrelated ${i}`, orgId: 'org-js', orgName: "Jon's Sandbox" });
			}
			const { deps } = makeDeps({ indexWorkflows: wfs });
			const out = await runWorkflowTool(
				{ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'jon sandbox' } },
				deps,
			);
			assert.match(out, /wf-named/, 'the by-name match is listed');
			assert.ok(!out.includes('Unrelated 0'), 'org-only matches are NOT listed inline (no flood)');
			assert.match(out, /Plus 20 workflow\(s\) in matching org\(s\)/, 'org-only matches are summarized');
			assert.match(out, /Jon's Sandbox \(20; orgId org-js\)/, 'summary names the org, count, and orgId to scope');
		});

		test('buddy_workflow_search indexes sub-orgs the same as managed orgs (one cross-org query)', async () => {
			// org-3 stands in for a sub-org that org enumeration would miss; the
			// unscoped workflows query returns it like any other.
			const { deps } = makeDeps({
				indexWorkflows: [
					{ id: 'wf-aaa', name: 'Onboarding', orgId: 'org-1', orgName: 'Primary Org' },
					{ id: 'wf-sub', name: 'Sub Onboarding', orgId: 'org-3', orgName: 'Sub Org' },
				],
			});
			const out = await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'onboarding' } }, deps);
			assert.match(out, /Sub Onboarding {2}\(id: wf-sub\) {2}org: Sub Org \(org-3\)/);
			assert.match(out, /across 2 org/);
		});

		test('buddy_render_jinja keys lists the context top-level keys instead of rendering', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'buddy_render_jinja', args: { orgId: 'org-1', executionId: 'exec-1', keys: true } },
				deps,
			);
			// Last snapshot in the mock is { proceed: true }.
			assert.match(output, /top-level keys/);
			assert.match(output, /proceed/);
			assert.match(output, /CTX\.execution_id/, 'hints the canonical system-var paths');
			assert.ok(!calls.some(c => c.query.includes('RewstBuddyRenderJinja')), 'keys mode does not render');
		});

		test('buddy_render_jinja keys works with ad-hoc vars', async () => {
			const { deps } = makeDeps();
			const output = await runWorkflowTool(
				{ tool: 'buddy_render_jinja', args: { orgId: 'org-1', vars: { alpha: 1, beta: 2 }, keys: true } },
				deps,
			);
			assert.match(output, /alpha, beta/);
		});

		test('buddy_render_jinja requires a template unless keys is set', async () => {
			const { deps } = makeDeps();
			await assert.rejects(
				() => runWorkflowTool({ tool: 'buddy_render_jinja', args: { orgId: 'org-1', vars: { a: 1 } } }, deps),
				/template/,
			);
		});

		test('buddy_workflow_run is scope-gated with a "run" confirmation', () => {
			const args = { workflowId: 'wf-1', workflowName: 'WF', orgId: 'org-1', orgName: 'Acme', input: { a: 1 } };
			assert.ok(workflowEditScope(WORKFLOW_RUN_TOOL_NAME, args), 'shares the per-workflow scope');
			const confirmation = workflowEditConfirmation(WORKFLOW_RUN_TOOL_NAME, args);
			assert.ok(confirmation);
			assert.match(confirmation!.message, /Run workflow/);
			assert.match(confirmation!.message, /executes the workflow/i);
		});

		test('buddy_workflow_run still prompts after the workflow scope was approved', () => {
			const args = { workflowId: 'wf-1', workflowName: 'WF', orgId: 'org-1', orgName: 'Acme', input: { a: 1 } };
			approveMutationScope({ scopeId: 'wf-1', scopeName: 'WF', orgId: 'org-1', orgName: 'Acme' });

			const confirmation = workflowEditConfirmation(WORKFLOW_RUN_TOOL_NAME, args);

			assert.ok(confirmation, 'running/testing a workflow requires approval every time');
			assert.match(confirmation!.message, /Run workflow/);
		});

		test('buddy_workflow_edit refuses when scope fields are missing', async () => {
			const { deps } = makeDeps();
			await assert.rejects(
				() =>
					runWorkflowTool(
						{ tool: 'buddy_workflow_edit', args: { workflowId: 'wf-1', operations: [{ op: 'add_task' }] } },
						deps,
					),
				/requires non-empty/,
			);
		});
	});
});
