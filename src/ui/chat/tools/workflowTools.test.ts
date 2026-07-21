import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import {
	ADD_TASK_FIELD_NAMES,
	ADVANCED_TASK_FIELD_TABLE,
	RESULT_SHAPE_STEERING,
	SET_VARIABLE_STEERING,
	UPDATE_TASK_SET_FIELD_NAMES,
	WORKFLOW_DATA_PASSING_STEERING,
	WORKFLOW_IMPACT_STEERING,
	WORKFLOW_RETRY_STEERING,
	WORKFLOW_START_STEERING,
	WORKFLOW_WITH_ITEMS_STEERING,
	workflowEditOperationGrammar,
	type RawWorkflow,
} from '@workflow';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { getCapability } from '../../../capabilities/registry';
import { _resetApprovedMutationScopes, approveMutationScope, type GraphqlToolDeps } from './graphqlTool';
import {
	_resetWorkflowIndexForTesting,
	applyOperations,
	autoLayout,
	isWorkflowTool,
	normalizePublish,
	runWorkflowTool,
	sentValueDivergences,
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_DIAGNOSE_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_TOOL_SPECS,
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

async function flushMicrotasks(turns = 5): Promise<void> {
	for (let i = 0; i < turns; i++) await Promise.resolve();
}

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

	test('workflow tool guidance does not reference unregistered tools', () => {
		const names = new Set(WORKFLOW_TOOL_SPECS.map(tool => tool.name));
		assert.ok(!names.has('buddy_workflow_impact'));
		// buddy_workflow_impact is referenced in buddy_workflow_edit's description via WORKFLOW_IMPACT_STEERING
		// but is NOT a WORKFLOW_TOOL_SPECS entry — that is correct by design
	});

	test('buddy_workflow_edit spec steers an impact check before sub-workflow contract changes', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.ok(
			spec.description.includes(WORKFLOW_IMPACT_STEERING),
			'buddy_workflow_edit description embeds WORKFLOW_IMPACT_STEERING verbatim',
		);
		assert.ok(
			spec.description.includes('buddy_workflow_impact'),
			'buddy_workflow_edit description mentions buddy_workflow_impact',
		);
		// Cross-layer drift guard: the capability must be registered
		assert.ok(
			getCapability('buddy_workflow_impact') !== undefined,
			'buddy_workflow_impact capability is registered (cross-layer drift guard)',
		);
	});

	test('buddy_workflow_edit spec steers retries as a delay-loop pattern', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.ok(
			spec.description.includes(WORKFLOW_RETRY_STEERING),
			'buddy_workflow_edit description embeds WORKFLOW_RETRY_STEERING verbatim',
		);
	});

	test('buddy_workflow_edit spec steers with-items loops to sub-workflow wrappers', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.ok(
			spec.description.includes(WORKFLOW_WITH_ITEMS_STEERING),
			'buddy_workflow_edit description embeds WORKFLOW_WITH_ITEMS_STEERING verbatim',
		);
	});

	test('buddy_workflow_edit spec steers primitive-only workflow data passing', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.ok(
			spec.description.includes(WORKFLOW_DATA_PASSING_STEERING),
			'buddy_workflow_edit description embeds WORKFLOW_DATA_PASSING_STEERING verbatim',
		);
	});

	test('buddy_workflow_edit spec steers new workflows to use a START anchor', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.ok(
			spec.description.includes(WORKFLOW_START_STEERING),
			'buddy_workflow_edit description embeds WORKFLOW_START_STEERING verbatim',
		);
	});

	test('buddy_workflow_edit spec documents transforms.set_variable result shape', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.ok(
			spec.description.includes(SET_VARIABLE_STEERING),
			'buddy_workflow_edit description embeds SET_VARIABLE_STEERING verbatim',
		);
	});

	test('buddy_workflow_get spec reserves full detail for ids and positions, not ordinary edits', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === 'buddy_workflow_get');
		assert.ok(spec, 'buddy_workflow_get spec exists');
		assert.strictEqual(spec.args, JSON.stringify(spec.inputSchema));
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

	test('buddy_workflow_edit spec lists advanced task fields and loop concurrency', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.match(spec.description, /runAsOrgId/, 'documents task org override edits');
		assert.match(spec.description, /packOverrides/, 'documents integration override edits');
		assert.match(spec.description, /isMocked/, 'documents task mocking edits');
		assert.match(spec.description, /mockInput/, 'documents mock input edits');
		assert.match(spec.description, /mock_result/, 'documents the required mock_result wrapper');
		assert.match(spec.description, /leaf value.*string/i, 'documents string-leaf mock result validation');
		assert.match(spec.description, /with:\s*\{items, concurrency\}/, 'documents loop concurrency shape');
		assert.match(spec.description, /add_task \{[^}]*description\?[^}]*runAsOrgId\?/, 'enumerates add_task fields');
	});

	test('buddy_workflow_edit operation grammar is generated from the edit allowlists', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');

		const grammar = workflowEditOperationGrammar();
		for (const field of ADD_TASK_FIELD_NAMES) {
			if (['op', 'id', 'transitionMode', 'join'].includes(field)) continue;
			assert.match(grammar, new RegExp(`\\b${field}\\??\\b`), `add_task grammar includes ${field}`);
		}
		for (const field of UPDATE_TASK_SET_FIELD_NAMES) {
			if (['transitionMode', 'join'].includes(field)) continue;
			assert.match(grammar, new RegExp(`\\b${field}\\??\\b`), `update_task grammar includes ${field}`);
		}
		assert.doesNotMatch(grammar, /\btransitionMode\b|\bjoin\b|FOLLOW_ALL|FOLLOW_FIRST/);
		assert.ok(spec.description.includes(grammar), 'tool description includes the generated grammar verbatim');
	});

	test('advanced task fields are driven by one coercion/verification table', () => {
		assert.deepStrictEqual(Object.keys(ADVANCED_TASK_FIELD_TABLE), [
			'runAsOrgId',
			'packOverrides',
			'isMocked',
			'mockInput',
		]);
		for (const [field, entry] of Object.entries(ADVANCED_TASK_FIELD_TABLE)) {
			assert.strictEqual(entry.verifyField, field, `${field} marks the same post-save verification field`);
			assert.strictEqual(typeof entry.coerce, 'function', `${field} carries a coercer`);
		}
	});

	test('buddy_workflow_edit spec teaches sub-workflow composition through set_output', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EDIT_TOOL_NAME);
		assert.ok(spec, 'buddy_workflow_edit spec exists');
		assert.match(spec.description, /set_output \{outputs/, 'set_output is listed as an operation');
		assert.match(
			spec.description,
			/RESULT\.<output-key>/,
			'ties a sub-workflow call result to the set_output contract',
		);
		assert.ok(spec.description.includes(RESULT_SHAPE_STEERING), 'RESULT shape steering appears verbatim');
		assert.match(spec.description, /RESULT\.result\.<field>/, 'teaches built-in action result shape');
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
			/update_task \{id\|name, set:\{name\?, input\?, action\? or subWorkflowId\?, publishResultAs\?, timeout\?, description\?, with\?, runAsOrgId\?, packOverrides\?, isMocked\?, mockInput\?\}\}/,
			'enumerates the update_task settable fields',
		);
	});

	test('buddy_render_jinja spec documents key ordering and backreference escaping gotchas', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === 'buddy_render_jinja');
		assert.ok(spec, 'buddy_render_jinja spec exists');
		assert.match(spec.description, /alphabetizes dict keys/i);
		assert.match(spec.description, /regex_replace/i);
		assert.match(spec.description, /\\\\1/, 'shows the doubled escaping needed for backreferences');
		assert.match(spec.description, /control character/i);
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
			// structural add_task without explicit x/y triggers automatic auto-layout, so applied has 2 entries
			assert.strictEqual(applied.length, 2);
			assert.match(applied[1], /autolayout \(automatic/);
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

		test('set_output rejects malformed name/value entries instead of misreading them as output keys', () => {
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[{ op: 'set_output', outputs: [{ name: 'success' }] } as WorkflowOperation],
						NO_ACTIONS,
					),
				/set_output.*name.*value/i,
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

		test('update_task sets advanced task execution fields instead of silently dropping them', () => {
			const ops: WorkflowOperation[] = [
				{
					op: 'update_task',
					name: 'start',
					set: {
						runAsOrgId: '{{ CTX.org_id }}',
						packOverrides: [
							{ packId: 'pack-1', packConfigId: 'cfg-1', configSelectionMode: 'USE_SELECTED_ID' },
						],
						isMocked: true,
						mockInput: { mock_result: { id: '{{ "mocked" }}' } },
					},
				},
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			const start = tasks.find(t => t.name === 'start')!;
			assert.strictEqual(start.runAsOrgId, '{{ CTX.org_id }}');
			assert.deepStrictEqual(start.packOverrides, [
				{ packId: 'pack-1', packConfigId: 'cfg-1', configSelectionMode: 'USE_SELECTED_ID' },
			]);
			assert.strictEqual(start.isMocked, true);
			assert.deepStrictEqual(start.mockInput, { mock_result: { id: '{{ "mocked" }}' } });
		});

		test('add_task accepts advanced task execution fields', () => {
			const ops: WorkflowOperation[] = [
				{
					op: 'add_task',
					name: 'notify',
					action: 'core.noop',
					runAsOrgId: '{{ CTX.org_id }}',
					packOverrides: [{ packId: 'pack-1', configSelectionMode: 'USE_DEFAULT' }],
					isMocked: true,
					mockInput: { mock_result: { ok: '{{ true }}' } },
				},
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			const notify = tasks.find(t => t.name === 'notify')!;
			assert.strictEqual(notify.runAsOrgId, '{{ CTX.org_id }}');
			assert.deepStrictEqual(notify.packOverrides, [{ packId: 'pack-1', configSelectionMode: 'USE_DEFAULT' }]);
			assert.strictEqual(notify.isMocked, true);
			assert.deepStrictEqual(notify.mockInput, { mock_result: { ok: '{{ true }}' } });
		});

		test('add_task rejects unsupported fields so agents do not trust silent drops', () => {
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'notify', action: 'core.noop', definitelyWrong: true },
			];
			assert.throws(
				() => applyOperations(sampleTasks() as never, ops, NOOP_REF),
				/Unsupported add_task field "definitelyWrong"/,
			);
		});

		test('advanced task fields reject unsupported nested fields', () => {
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[
							{
								op: 'add_task',
								name: 'notify',
								action: 'core.noop',
								packOverrides: [{ packId: 'pack-1', configSelectionMode: 'USE_DEFAULT', extra: true }],
							},
						],
						NOOP_REF,
					),
				/Unsupported packOverrides\[0\] field "extra"/,
			);
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[
							{
								op: 'update_task',
								name: 'start',
								set: { retry: { count: '2', delay: '5', extra: true } },
							},
						],
						NO_ACTIONS,
					),
				/delay task/i,
			);
		});

		test('add_task with retry throws the loop guidance', () => {
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[{ op: 'add_task', name: 'notify', action: 'core.noop', retry: { count: '3' } }],
						NOOP_REF,
					),
				(err: Error) => {
					assert.match(err.message, /delay task/i);
					assert.match(err.message, /sub-workflow/i);
					return true;
				},
			);
			// No task was added
			const { tasks } = applyOperations(sampleTasks() as never, [], NOOP_REF);
			assert.strictEqual(tasks.length, sampleTasks().length);
		});

		test('add_task with retries (plural) throws the loop guidance', () => {
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[{ op: 'add_task', name: 'notify', action: 'core.noop', retries: 3 }],
						NOOP_REF,
					),
				(err: Error) => {
					assert.match(err.message, /delay task/i);
					assert.match(err.message, /sub-workflow/i);
					return true;
				},
			);
		});

		test('update_task.set retry throws and leaves the task untouched', () => {
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[{ op: 'update_task', name: 'start', set: { retry: { count: '3' } } }],
						NO_ACTIONS,
					),
				(err: Error) => {
					assert.match(err.message, /delay task/i);
					return true;
				},
			);
		});

		test('existing task retry is preserved by unrelated edits', () => {
			// Seed a task with a stored retry config (as if saved before the guardrail)
			const tasksWithRetry = sampleTasks() as import('../../../workflow/types').RawTask[];
			(tasksWithRetry[0] as import('../../../workflow/types').RawTask & { retry?: unknown }).retry = {
				count: '3',
				delay: '5',
				when: '{{ FAILED }}',
			};
			// Apply an unrelated edit (rename the other task)
			const { tasks } = applyOperations(
				tasksWithRetry as never,
				[{ op: 'update_task', name: 'end', set: { description: 'touched' } }],
				NO_ACTIONS,
			);
			// The retry on 'start' must survive the round-trip
			assert.deepStrictEqual(
				(tasks.find(t => t.name === 'start') as import('../../../workflow/types').RawTask & { retry?: unknown })
					?.retry,
				{ count: '3', delay: '5', when: '{{ FAILED }}' },
			);
		});

		test('connect with custom when and no label throws', () => {
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[{ op: 'connect', from: 'start', to: 'end', when: '{{ FAILED }}' }],
						NO_ACTIONS,
					),
				/connect: a custom transition.*requires a non-empty "label"/i,
			);
		});

		test('connect with custom when and label succeeds', () => {
			const { tasks } = applyOperations(
				sampleTasks() as never,
				[{ op: 'connect', from: 'start', to: 'end', when: '{{ FAILED }}', label: 'on failure' }],
				NO_ACTIONS,
			);
			const tr = tasks.find(t => t.name === 'start')!.next!.find(t => t.when === '{{ FAILED }}');
			assert.ok(tr, 'transition exists');
			assert.strictEqual(tr!.label, 'on failure');
		});

		test('connect success transition without label still works', () => {
			const { tasks } = applyOperations(
				sampleTasks() as never,
				[{ op: 'connect', from: 'end', to: 'start', when: '{{ SUCCEEDED }}' }],
				NO_ACTIONS,
			);
			const startId = tasks.find(t => t.name === 'start')!.id;
			const tr = tasks
				.find(t => t.name === 'end')!
				.next!.find(t => t.when === '{{ SUCCEEDED }}' && (t.do ?? []).includes(startId));
			assert.ok(tr, 'success transition added without label');
		});

		test('set_transition making a condition custom without a label throws', () => {
			const { tasks: withTr } = applyOperations(
				sampleTasks() as never,
				[{ op: 'connect', from: 'end', to: 'start', when: '{{ SUCCEEDED }}', label: '' }],
				NO_ACTIONS,
			);
			assert.throws(
				() =>
					applyOperations(
						withTr as never,
						[{ op: 'set_transition', from: 'end', to: 'start', set: { when: '{{ FAILED }}' } }],
						NO_ACTIONS,
					),
				/set_transition.*custom condition.*requires a non-empty "label"/i,
			);
		});

		test('set_transition custom with label in the same set succeeds', () => {
			const { tasks: withTr } = applyOperations(
				sampleTasks() as never,
				[{ op: 'connect', from: 'end', to: 'start', when: '{{ SUCCEEDED }}', label: '' }],
				NO_ACTIONS,
			);
			const { tasks } = applyOperations(
				withTr as never,
				[{ op: 'set_transition', from: 'end', to: 'start', set: { when: '{{ FAILED }}', label: 'on fail' } }],
				NO_ACTIONS,
			);
			const tr = tasks.find(t => t.name === 'end')!.next!.find(t => t.when === '{{ FAILED }}');
			assert.ok(tr);
			assert.strictEqual(tr!.label, 'on fail');
		});

		test('set_transition clearing the label on a custom transition throws', () => {
			const { tasks: withTr } = applyOperations(
				sampleTasks() as never,
				[{ op: 'connect', from: 'end', to: 'start', when: '{{ FAILED }}', label: 'on fail' }],
				NO_ACTIONS,
			);
			assert.throws(
				() =>
					applyOperations(
						withTr as never,
						[{ op: 'set_transition', from: 'end', to: 'start', set: { label: '' } }],
						NO_ACTIONS,
					),
				/set_transition.*custom condition.*requires a non-empty "label"/i,
			);
		});

		test('packOverrides rejects unknown config mode values before save', () => {
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[
							{
								op: 'add_task',
								name: 'notify',
								action: 'core.noop',
								packOverrides: [{ packId: 'pack-1', configSelectionMode: 'USE_SELCTED_ID' }],
							},
						],
						NOOP_REF,
					),
				/packOverrides\[0\]\.configSelectionMode.*USE_SELCTED_ID/,
			);
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[
							{
								op: 'update_task',
								name: 'start',
								set: { packOverrides: [{ packId: 'pack-1', configFallbackMode: 'USE_DEFAUT' }] },
							},
						],
						NO_ACTIONS,
					),
				/packOverrides\[0\]\.configFallbackMode.*USE_DEFAUT/,
			);
		});

		test('update_task rejects unsupported set fields so agents do not trust silent drops', () => {
			const ops: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { definitelyWrong: true } }];
			assert.throws(
				() => applyOperations(sampleTasks() as never, ops, NO_ACTIONS),
				/Unsupported update_task\.set field "definitelyWrong"/,
			);
		});

		test('add_task accepts a description like update_task does', () => {
			const ops: WorkflowOperation[] = [
				{ op: 'add_task', name: 'notify', action: 'core.noop', description: 'Sends the alert' },
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			assert.strictEqual(tasks.find(t => t.name === 'notify')!.description, 'Sends the alert');
		});

		test('mockInput parses a JSON-string payload back to a mock_result object', () => {
			const ops: WorkflowOperation[] = [
				{
					op: 'add_task',
					name: 'notify',
					action: 'core.noop',
					isMocked: true,
					mockInput: '{"mock_result": {"ok": "{{ true }}"}}',
				},
				{
					op: 'update_task',
					name: 'start',
					set: { isMocked: true, mockInput: '{"mock_result": {"id": "{{ \\"mocked\\" }}"}}' },
				},
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			assert.deepStrictEqual(tasks.find(t => t.name === 'notify')!.mockInput, {
				mock_result: { ok: '{{ true }}' },
			});
			assert.deepStrictEqual(tasks.find(t => t.name === 'start')!.mockInput, {
				mock_result: { id: '{{ "mocked" }}' },
			});
		});

		test('mockInput rejects payloads without the mock_result wrapper', () => {
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[
							{
								op: 'add_task',
								name: 'notify',
								action: 'core.noop',
								isMocked: true,
								mockInput: { ok: 'yes' },
							},
						],
						NOOP_REF,
					),
				/mockInput\.mock_result must be present/,
			);
			assert.throws(
				() =>
					applyOperations(
						sampleTasks() as never,
						[{ op: 'update_task', name: 'start', set: { mockInput: { ok: 'yes' } } }],
						NO_ACTIONS,
					),
				/mockInput\.mock_result must be present/,
			);
		});

		test('mockInput rejects non-string leaves under mock_result', () => {
			// Arrays are containers — recurse into them; non-string elements inside still throw
			for (const value of [42, true, [42], { nested: false }]) {
				assert.throws(
					() =>
						applyOperations(
							sampleTasks() as never,
							[
								{
									op: 'update_task',
									name: 'start',
									set: { mockInput: { mock_result: { value } } },
								},
							],
							NO_ACTIONS,
						),
					/mockInput\.mock_result.*leaf values must be strings/,
				);
			}
		});

		test('mockInput accepts arrays of string leaves under mock_result', () => {
			const ops: WorkflowOperation[] = [
				{
					op: 'update_task',
					name: 'start',
					set: { mockInput: { mock_result: { items: ['{{ CTX.a }}', '{{ CTX.b }}'] } } },
				},
			];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NO_ACTIONS);
			assert.deepStrictEqual(tasks.find(t => t.name === 'start')!.mockInput, {
				mock_result: { items: ['{{ CTX.a }}', '{{ CTX.b }}'] },
			});
		});

		test('retry.count rejects with loop guidance (retry is no longer accepted)', () => {
			for (const count of [{ value: 3 }, [3], true]) {
				assert.throws(
					() =>
						applyOperations(
							sampleTasks() as never,
							[{ op: 'update_task', name: 'start', set: { retry: { count } } }],
							NO_ACTIONS,
						),
					/delay task/i,
				);
			}
		});

		test('update_task.set x/y error points at the reposition op', () => {
			const ops: WorkflowOperation[] = [{ op: 'update_task', name: 'start', set: { x: 100, y: 400 } }];
			assert.throws(() => applyOperations(sampleTasks() as never, ops, NO_ACTIONS), /reposition \{task, x, y\}/);
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
				{ op: 'connect', from: 'start', to: 'special', when: '{{ RESULT.flag }}', label: 'flag set' },
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

		test('an unconnected new task gets a valid canvas position', () => {
			const ops: WorkflowOperation[] = [{ op: 'add_task', name: 'orphan', action: 'core.noop' }];
			const { tasks } = applyOperations(sampleTasks() as never, ops, NOOP_REF);
			const orphan = tasks.find(t => t.name === 'orphan')!.metadata as { x: number; y: number };
			// add_task without x/y is a structural op — auto-layout runs and assigns
			// all positions, so we just verify the orphan got a finite position.
			assert.ok(Number.isFinite(orphan.x), 'orphan x should be finite');
			assert.ok(Number.isFinite(orphan.y), 'orphan y should be finite');
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

	suite('section autolayout (#188)', () => {
		const noop = (id: string, dos: string[][] = [], p?: { x: number; y: number }) => ({
			id,
			name: id,
			actionId: 'noop-id',
			action: { ref: 'core.noop' },
			input: {},
			metadata: p ? { ...p } : {},
			next: dos.map(d => ({ when: '{{ SUCCEEDED }}', label: '', do: d, publish: [] })),
		});

		test('the autolayout operation accepts a section anchor and leaves the rest in place', () => {
			const tasks = [
				noop('s', [['a']], { x: 0, y: 0 }),
				noop('a', [['b']], { x: 0, y: 168 }),
				noop('b', [['c'], ['d']], { x: 0, y: 336 }),
				noop('c', [['e']], { x: 0, y: 504 }),
				noop('d', [['e']], { x: 500, y: 504 }),
				noop('e', [['f']], { x: 0, y: 672 }),
				noop('f', [], { x: 0, y: 840 }),
			];
			const { tasks: out, applied } = applyOperations(
				tasks as never,
				[{ op: 'autolayout', section: 'b' }],
				NO_ACTIONS,
			);
			assert.match(applied[0], /autolayout section/);
			assert.ok(
				!applied.some(entry => entry.includes('automatic after structural edits')),
				'a section autolayout counts as explicit positioning',
			);
			const get = (id: string) => out.find(t => t.id === id)!.metadata as { x: number; y: number };
			assert.deepStrictEqual(get('s'), { x: 0, y: 0 }, 'upstream task untouched');
			assert.deepStrictEqual(get('a'), { x: 0, y: 168 }, 'upstream task untouched');
			assert.strictEqual(get('c').y, get('d').y, 'the diamond arms share a recomputed row');
		});

		test('an over-long transition line adds a reorganization note to the applied list', () => {
			const tasks = [
				noop('start', [['n1'], ['n6']]),
				noop('n1', [['n2']]),
				noop('n2', [['n3']]),
				noop('n3', [['n4']]),
				noop('n4', [['n5']]),
				noop('n5', [['n6']]),
				noop('n6'),
			];
			const { applied } = applyOperations(tasks as never, [{ op: 'autolayout' }], NO_ACTIONS);
			const note = applied.find(entry => entry.includes('transition line'));
			assert.ok(note, 'a long-line note is present');
			assert.match(note!, /start -> n6/);
			assert.match(note!, /section/);
		});

		test('a short flow gets no long-line note', () => {
			const { applied } = applyOperations(sampleTasks() as never, [{ op: 'autolayout' }], NO_ACTIONS);
			assert.ok(!applied.some(entry => entry.includes('transition line')));
		});

		test('buddy_workflow_autolayout spec and edit grammar document the section option', () => {
			const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_AUTOLAYOUT_TOOL_NAME)!;
			assert.match(spec.description, /section/);
			assert.match(spec.description, /single-entry\/single-exit/);
			const schema = spec.inputSchema as { properties: Record<string, unknown>; required?: string[] };
			assert.ok('section' in schema.properties, 'inputSchema advertises section');
			assert.ok(!schema.required?.includes('section'), 'section stays optional');
			assert.match(workflowEditOperationGrammar(), /autolayout \{section\?\}/);
		});

		test('autolayout confirmation names the section when one is given', () => {
			const args = {
				workflowId: 'wf-1',
				workflowName: 'WF',
				orgId: 'org-1',
				orgName: 'Acme',
				section: 'END',
			};
			const confirmation = workflowEditConfirmation(WORKFLOW_AUTOLAYOUT_TOOL_NAME, args);
			assert.ok(confirmation, 'unapproved scope prompts');
			assert.match(confirmation!.message, /section/i);
			assert.match(confirmation!.message, /END/);
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

		test('still prompts after the workflow scope was approved this session', () => {
			approveMutationScope({ scopeId: 'wf-1', scopeName: 'WF', orgId: 'org-1', orgName: 'Acme' });
			const confirmation = workflowEditConfirmation(WORKFLOW_EDIT_TOOL_NAME, fullArgs);
			assert.ok(confirmation, 'each edit is a distinct graph change and requires approval every time');
			assert.match(confirmation!.message, /WF/);
		});

		test('autolayout confirmation is skipped once the workflow scope is approved', () => {
			approveMutationScope({ scopeId: 'wf-1', scopeName: 'WF', orgId: 'org-1', orgName: 'Acme' });
			const args = { workflowId: 'wf-1', workflowName: 'WF', orgId: 'org-1', orgName: 'Acme' };
			assert.strictEqual(workflowEditConfirmation(WORKFLOW_AUTOLAYOUT_TOOL_NAME, args), undefined);
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
				taskLogsByExecution: Record<string, unknown[]>;
				childExecutions: unknown[];
				childExecutionsError: string;
				executions: unknown[];
				executionOwnerOrgId: string;
				executionWorkflowOrgId: string;
				executionManagingOrgId: string;
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
				if (query.includes('RewstBuddyExecutionDetail')) {
					const where = (variables?.where ?? {}) as { id?: string };
					const ownerOrgId = over.executionOwnerOrgId ?? 'org-1';
					const workflowOrgId = over.executionWorkflowOrgId ?? ownerOrgId;
					return {
						data: {
							workflowExecution: {
								id: where.id,
								status: over.pollStatus ?? 'failed',
								orgId: ownerOrgId,
								organization: {
									id: ownerOrgId,
									managingOrgId: over.executionManagingOrgId,
								},
								workflow: {
									id: 'wf-1',
									name: 'Sample',
									orgId: workflowOrgId,
								},
							},
						},
					};
				}
				if (query.includes('RewstBuddyExecutions')) {
					const where = (variables?.where ?? {}) as { id?: string; workflowId?: string; orgId?: string };
					// where.id => run-and-wait poll for a single execution's status.
					if (where.id) {
						if (where.orgId && over.executionOwnerOrgId && where.orgId !== over.executionOwnerOrgId) {
							return { data: { workflowExecutions: [] } };
						}
						if (over.pollError) return { errors: [{ message: over.pollError }] };
						return {
							data: {
								workflowExecutions: [
									{
										id: where.id,
										status: over.pollStatus ?? 'failed',
										orgId: over.executionOwnerOrgId ?? where.orgId,
									},
								],
							},
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
					const where = (variables?.where ?? {}) as { workflowExecutionId?: string };
					const byExecution = over.taskLogsByExecution ?? {};
					if (where.workflowExecutionId && where.workflowExecutionId in byExecution) {
						return { data: { taskLogs: byExecution[where.workflowExecutionId] } };
					}
					return { data: { taskLogs: over.taskLogs ?? [] } };
				}
				if (query.includes('RewstBuddyChildExecutions')) {
					if (over.childExecutionsError) return { errors: [{ message: over.childExecutionsError }] };
					return {
						data: { workflowExecution: { id: 'exec-1', childExecutions: over.childExecutions ?? [] } },
					};
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
			assert.match(parsed.note, /RESULT\.result\.<field>/, 'the note teaches built-in action results');
			assert.match(parsed.note, /RESULT\.<output-key>/, 'the note teaches sub-workflow output keys');
			assert.doesNotMatch(
				parsed.note,
				/RESULT\.<name>|RESULT\.<field>/,
				'the note avoids ambiguous result placeholders',
			);
		});

		test('buddy_workflow_get surfaces non-default advanced task fields only when behavior changes', async () => {
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
									task({
										name: 'fanout',
										transitionMode: 'FOLLOW_ALL',
										join: 1,
										runAsOrgId: '{{ CTX.org_id }}',
										isMocked: true,
										mockInput: { sample: 'value' },
										retry: { count: '3', delay: '5', when: '{{ FAILED }}' },
									}),
									task({ name: 'merge', transitionMode: 'FOLLOW_FIRST', join: 0 }),
									task({
										name: 'plain',
										transitionMode: 'FOLLOW_FIRST',
										join: 1,
										isMocked: false,
										mockInput: { stale: true },
									}),
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
			assert.strictEqual(byName('fanout').transitionMode, 'FOLLOW_ALL');
			assert.ok(!('join' in byName('fanout')), 'default join is omitted');
			assert.strictEqual(byName('fanout').runAsOrgId, '{{ CTX.org_id }}');
			assert.strictEqual(byName('fanout').isMocked, true);
			assert.deepStrictEqual(byName('fanout').mockInput, { sample: 'value' });
			assert.deepStrictEqual(byName('fanout').retry, { count: '3', delay: '5', when: '{{ FAILED }}' });
			assert.strictEqual(byName('merge').join, 0);
			assert.ok(!('transitionMode' in byName('merge')), 'default mode is omitted');
			assert.ok(!('isMocked' in byName('plain')), 'false mocked state is omitted');
			assert.ok(!('mockInput' in byName('plain')), 'disabled mock payload is omitted');
		});

		test('buddy_workflow_get replaces a large mockInput with a size note in summary but keeps it in full', async () => {
			const bigPayload = { blob: 'x'.repeat(2000) };
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
									{
										id: 'mocked',
										name: 'mocked',
										actionId: 'x',
										action: { ref: 'core.noop' },
										next: [],
										isMocked: true,
										mockInput: bigPayload,
									},
								],
							},
						},
					};
				}
				return { data: {} };
			};
			const deps: GraphqlToolDeps = { isEnabled: () => true, confirmMutation: async () => true, execute };
			const summary = JSON.parse(
				await runWorkflowTool(
					{ tool: 'buddy_workflow_get', args: { workflowId: 'wf-1', orgId: 'org-1' } },
					deps,
				),
			);
			const summaryNode = summary.nodes[0];
			assert.strictEqual(summaryNode.isMocked, true);
			assert.strictEqual(
				typeof summaryNode.mockInput,
				'string',
				'summary carries a placeholder, not the payload',
			);
			assert.match(summaryNode.mockInput, /detail:"full"/);
			assert.ok(!JSON.stringify(summary).includes('xxxxxxxxxx'), 'payload does not leak into the summary');
			const full = JSON.parse(
				await runWorkflowTool(
					{ tool: 'buddy_workflow_get', args: { workflowId: 'wf-1', orgId: 'org-1', detail: 'full' } },
					deps,
				),
			);
			assert.deepStrictEqual(full.nodes[0].mockInput, bigPayload, 'full detail keeps the verbatim payload');
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

		test('buddy_render_jinja verifies the execution belongs to the requested org before reading context', async () => {
			const { deps, calls } = makeDeps({ executionOwnerOrgId: 'org-2' });

			await assert.rejects(
				() =>
					runWorkflowTool(
						{
							tool: 'buddy_render_jinja',
							args: { orgId: 'org-1', executionId: 'exec-1', template: '{{ CTX.proceed }}' },
						},
						deps,
					),
				/execution exec-1.*org org-1/i,
			);
			assert.ok(
				!calls.some(c => c.query.includes('RewstBuddyExecutionContexts')),
				'context is not fetched until ownership is proven',
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

		test('buddy_render_jinja warns when the rendered value contains control characters', async () => {
			const { deps } = makeDeps({ renderResult: '\u0001' });
			const output = await runWorkflowTool(
				{
					tool: 'buddy_render_jinja',
					args: { orgId: 'org-1', vars: {}, template: "{{ 'x' | regex_replace('x', '\\\\1') }}" },
				},
				deps,
			);
			assert.match(output, /Rendered:/);
			assert.match(output, /WARNING.*control character/i);
			assert.match(output, /regex_replace.*\\\\\\\\1/i);
		});

		test('buddy_render_jinja does not warn about ordinary multiline or tabbed output', async () => {
			const { deps } = makeDeps({ renderResult: 'line1\nline2\tcolumn\r\nend' });
			const output = await runWorkflowTool(
				{
					tool: 'buddy_render_jinja',
					args: { orgId: 'org-1', vars: {}, template: "{{ items | join('\\n') }}" },
				},
				deps,
			);
			assert.match(output, /Rendered:/);
			assert.doesNotMatch(output, /WARNING/, 'newlines, tabs, and carriage returns are legitimate output');
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
			// add_task is structural so auto-layout runs as a second op; match the
			// explicit add_task line rather than the total operation count.
			assert.match(output, /add_task notify/);
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

		test('buddy_workflow_edit warns when the server did not store advanced task fields as sent', async () => {
			let gets = 0;
			const execute: GraphqlToolDeps['execute'] = async query => {
				if (query.includes('RewstBuddyWorkflowGet')) {
					gets += 1;
					const workflow = sampleWorkflow();
					if (gets > 1) {
						workflow.tasks = sampleTasks().map(task =>
							task.name === 'start'
								? {
										...task,
										runAsOrgId: null,
										packOverrides: [
											{
												packId: 'pack-1',
												packConfigId: 'cfg-other',
												configSelectionMode: 'USE_SELECTED_ID',
											},
										],
									}
								: task,
						);
					}
					return { data: { workflow } };
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
								set: {
									runAsOrgId: '{{ CTX.org_id }}',
									packOverrides: [
										{
											packId: 'pack-1',
											packConfigId: 'cfg-1',
											configSelectionMode: 'USE_SELECTED_ID',
										},
									],
								},
							},
						],
					},
				},
				deps,
			);

			assert.strictEqual(gets, 2, 'advanced task fields are verified with a re-read');
			assert.match(output, /WARNING — the server did not store/i);
			assert.match(output, /task "start": runAsOrgId/);
			assert.match(output, /task "start": packOverrides\.0\.packConfigId/);
			assert.match(output, /advanced configuration or field mapping/i);
		});

		test("buddy_workflow_edit self-heals a newly created task's packOverrides mode when the server defaults it on creation (#174)", async () => {
			// Server-side quirk: updateWorkflow ignores configSelectionMode /
			// configFallbackMode on the SAME write that creates a task, but honors
			// them on a follow-up update of that now-existing task. The tool should
			// detect and replay the corrective write itself, instead of surfacing
			// only a warning and requiring the caller to redo it manually.
			let gets = 0;
			let updates = 0;
			const sentOverrides = [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_SELECTED_ID',
					configFallbackMode: 'FAIL_ACTION',
				},
			];
			const defaultedOverrides = [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_DEFAULT',
					configFallbackMode: 'USE_DEFAULT',
				},
			];
			const execute: GraphqlToolDeps['execute'] = async query => {
				if (query.includes('RewstBuddyActionSearch')) {
					return { data: { actionsForOrg: [{ id: 'noop-id', ref: 'core.noop', name: 'noop' }] } };
				}
				if (query.includes('RewstBuddyWorkflowGet')) {
					gets += 1;
					const w = sampleWorkflow();
					if (gets === 1) return { data: { workflow: w } }; // before the edit: task doesn't exist yet
					const created = {
						id: 'cc03',
						name: 'notify',
						actionId: 'noop-id',
						action: { ref: 'core.noop' },
						input: {},
						metadata: { x: 0, y: 0 },
						next: [],
						packOverrides: updates >= 2 ? sentOverrides : defaultedOverrides,
					};
					w.tasks = [...sampleTasks(), created];
					return { data: { workflow: w } };
				}
				if (query.includes('RewstBuddyWorkflowUpdate')) {
					updates += 1;
					return { data: { updateWorkflow: { id: 'wf-1', updatedAt: String(1000 + updates * 500) } } };
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
								op: 'add_task',
								id: 'cc03',
								name: 'notify',
								action: 'core.noop',
								packOverrides: sentOverrides,
							},
						],
					},
				},
				deps,
			);

			assert.strictEqual(updates, 2, 'the save is replayed once to self-heal the packOverrides mode');
			assert.match(output, /auto-corrected packOverrides/i);
			assert.ok(
				!/WARNING — the server did not store/i.test(output),
				'the warning is dropped once the heal succeeds',
			);
			assert.match(
				output,
				/New version token: 2000/,
				"the reported version token must be the heal write's own updatedAt, not the stale first-write token",
			);
		});

		test("buddy_workflow_edit does not replay a heal write for a task whose own packOverrides did not diverge, even when another task's did (#174)", async () => {
			// healable (created-task) packOverrides gating must be scoped per task —
			// a divergence warning anywhere in the output must not trigger a heal
			// replay for a created task whose own packOverrides already match.
			let gets = 0;
			let updates = 0;
			const sentOverrides = [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_SELECTED_ID',
					configFallbackMode: 'FAIL_ACTION',
				},
			];
			const execute: GraphqlToolDeps['execute'] = async query => {
				if (query.includes('RewstBuddyActionSearch')) {
					return { data: { actionsForOrg: [{ id: 'noop-id', ref: 'core.noop', name: 'noop' }] } };
				}
				if (query.includes('RewstBuddyWorkflowGet')) {
					gets += 1;
					const w = sampleWorkflow();
					if (gets === 1) return { data: { workflow: w } };
					// 'notify' (newly created) already stored with the correct sent
					// overrides — no divergence for it. 'start' (an existing, updated
					// task, not created this batch) diverges on an unrelated field the
					// server silently stripped.
					const created = {
						id: 'cc03',
						name: 'notify',
						actionId: 'noop-id',
						action: { ref: 'core.noop' },
						input: {},
						metadata: { x: 0, y: 0 },
						next: [],
						packOverrides: sentOverrides,
					};
					w.tasks = sampleTasks().map(t =>
						t.name === 'start'
							? { ...t, packOverrides: [{ packId: 'pack-2', configSelectionMode: 'USE_DEFAULT' }] }
							: t,
					);
					w.tasks.push(created);
					return { data: { workflow: w } };
				}
				if (query.includes('RewstBuddyWorkflowUpdate')) {
					updates += 1;
					return { data: { updateWorkflow: { id: 'wf-1', updatedAt: String(1000 + updates * 500) } } };
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
								op: 'add_task',
								id: 'cc03',
								name: 'notify',
								action: 'core.noop',
								packOverrides: sentOverrides,
							},
							{
								op: 'update_task',
								name: 'start',
								set: { packOverrides: [{ packId: 'pack-2', configSelectionMode: 'USE_SELECTED_ID' }] },
							},
						],
					},
				},
				deps,
			);

			assert.strictEqual(updates, 1, 'no heal replay for a created task whose own packOverrides already matched');
			assert.match(
				output,
				/WARNING — the server did not store/i,
				'the unrelated divergence on "start" still warns',
			);
			assert.ok(!/auto-corrected packOverrides/i.test(output), 'nothing was actually healed');
		});

		test('buddy_workflow_edit keeps the warning when the packOverrides self-heal replay still diverges (#174)', async () => {
			let gets = 0;
			let updates = 0;
			const sentOverrides = [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_SELECTED_ID',
					configFallbackMode: 'FAIL_ACTION',
				},
			];
			const defaultedOverrides = [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_DEFAULT',
					configFallbackMode: 'USE_DEFAULT',
				},
			];
			const execute: GraphqlToolDeps['execute'] = async query => {
				if (query.includes('RewstBuddyActionSearch')) {
					return { data: { actionsForOrg: [{ id: 'noop-id', ref: 'core.noop', name: 'noop' }] } };
				}
				if (query.includes('RewstBuddyWorkflowGet')) {
					gets += 1;
					const w = sampleWorkflow();
					if (gets === 1) return { data: { workflow: w } };
					// The server keeps defaulting the mode even after the heal replay —
					// the warning should survive rather than being dropped.
					const created = {
						id: 'cc03',
						name: 'notify',
						actionId: 'noop-id',
						action: { ref: 'core.noop' },
						input: {},
						metadata: { x: 0, y: 0 },
						next: [],
						packOverrides: defaultedOverrides,
					};
					w.tasks = [...sampleTasks(), created];
					return { data: { workflow: w } };
				}
				if (query.includes('RewstBuddyWorkflowUpdate')) {
					updates += 1;
					return { data: { updateWorkflow: { id: 'wf-1', updatedAt: String(1000 + updates * 500) } } };
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
								op: 'add_task',
								id: 'cc03',
								name: 'notify',
								action: 'core.noop',
								packOverrides: sentOverrides,
							},
						],
					},
				},
				deps,
			);

			assert.strictEqual(updates, 2, 'exactly one heal replay is attempted, not a retry loop');
			assert.match(output, /WARNING — the server did not store/i);
			assert.match(output, /task "notify": packOverrides\.0\.configSelectionMode/);
		});

		test('buddy_workflow_edit keeps the packOverrides warning when self-heal verification cannot re-read (#174)', async () => {
			let gets = 0;
			let updates = 0;
			const sentOverrides = [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_SELECTED_ID',
					configFallbackMode: 'FAIL_ACTION',
				},
			];
			const defaultedOverrides = [
				{
					packId: 'pack-1',
					packConfigId: 'cfg-1',
					configSelectionMode: 'USE_DEFAULT',
					configFallbackMode: 'USE_DEFAULT',
				},
			];
			const execute: GraphqlToolDeps['execute'] = async query => {
				if (query.includes('RewstBuddyActionSearch')) {
					return { data: { actionsForOrg: [{ id: 'noop-id', ref: 'core.noop', name: 'noop' }] } };
				}
				if (query.includes('RewstBuddyWorkflowGet')) {
					gets += 1;
					if (gets === 4) return { errors: [{ message: 'temporary read failure' }] };
					const w = sampleWorkflow();
					if (gets === 1) return { data: { workflow: w } };
					const created = {
						id: 'cc03',
						name: 'notify',
						actionId: 'noop-id',
						action: { ref: 'core.noop' },
						input: {},
						metadata: { x: 0, y: 0 },
						next: [],
						packOverrides: defaultedOverrides,
					};
					w.tasks = [...sampleTasks(), created];
					return { data: { workflow: w } };
				}
				if (query.includes('RewstBuddyWorkflowUpdate')) {
					updates += 1;
					return { data: { updateWorkflow: { id: 'wf-1', updatedAt: String(1000 + updates * 500) } } };
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
								op: 'add_task',
								id: 'cc03',
								name: 'notify',
								action: 'core.noop',
								packOverrides: sentOverrides,
							},
						],
					},
				},
				deps,
			);

			assert.strictEqual(updates, 2, 'the self-heal write still succeeds before the verification read fails');
			assert.strictEqual(gets, 4, 'the final verification read is attempted');
			assert.match(output, /WARNING — the server did not store/i);
			assert.match(output, /task "notify": packOverrides\.0\.configSelectionMode/);
			assert.ok(!/auto-corrected packOverrides/i.test(output), 'failed verification must not claim success');
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

		test('buddy_workflow_edit verifies inputs when the same operation renames the task', async () => {
			const { deps, calls } = makeDeps();
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
								set: { name: 'renamed', input: { params: { text: 'x' } } },
							},
						],
					},
				},
				deps,
			);
			const gets = calls.filter(c => c.query.includes('RewstBuddyWorkflowGet'));
			assert.strictEqual(gets.length, 2, 'the save is verified with a re-read despite the rename');
			assert.match(output, /WARNING — the server did not store/i);
			assert.match(output, /task "renamed": input\.params/);
		});

		test('buddy_workflow_edit verifies inputs when a later operation renames the task', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
					args: {
						workflowId: 'wf-1',
						workflowName: 'Sample',
						orgId: 'org-1',
						orgName: 'Acme',
						operations: [
							{ op: 'update_task', name: 'start', set: { input: { params: { text: 'x' } } } },
							{ op: 'update_task', name: 'start', set: { name: 'renamed' } },
						],
					},
				},
				deps,
			);
			const gets = calls.filter(c => c.query.includes('RewstBuddyWorkflowGet'));
			assert.strictEqual(gets.length, 2, 'the touched task is still verified after the rename');
			assert.match(output, /task "renamed": input\.params/);
		});

		test('buddy_workflow_edit does not verify a task deleted later in the batch', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: 'buddy_workflow_edit',
					args: {
						workflowId: 'wf-1',
						workflowName: 'Sample',
						orgId: 'org-1',
						orgName: 'Acme',
						operations: [
							{ op: 'update_task', name: 'start', set: { input: { params: { text: 'x' } } } },
							{ op: 'delete_task', name: 'start' },
						],
					},
				},
				deps,
			);
			const gets = calls.filter(c => c.query.includes('RewstBuddyWorkflowGet'));
			assert.strictEqual(gets.length, 1, 'no verification read when the touched task was deleted');
			assert.doesNotMatch(output, /WARNING/);
		});

		test('buddy_workflow_edit warns when an explicit input clear leaves stored keys behind', async () => {
			const calls: { query: string; variables?: Record<string, unknown> }[] = [];
			let getCount = 0;
			const workflowWithInput = (input: Record<string, unknown>) => ({
				...sampleWorkflow(),
				tasks: sampleTasks().map(task => (task.name === 'start' ? { ...task, input } : task)),
			});
			const execute: GraphqlToolDeps['execute'] = async (query, variables) => {
				calls.push({ query, variables });
				if (query.includes('RewstBuddyWorkflowGet')) {
					getCount++;
					return { data: { workflow: workflowWithInput({ stale: true }) } };
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
						operations: [{ op: 'update_task', name: 'start', set: { input: null } }],
					},
				},
				deps,
			);

			assert.strictEqual(getCount, 2, 'the explicit clear is verified with a re-read');
			assert.match(output, /WARNING — the server did not store/i);
			assert.match(output, /task "start": input\.stale/);
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

		test('buddy_workflow_autolayout forwards a section anchor', async () => {
			const { deps, calls } = makeDeps();
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_AUTOLAYOUT_TOOL_NAME,
					args: {
						workflowId: 'wf-1',
						workflowName: 'Sample',
						orgId: 'org-1',
						orgName: 'Acme',
						section: 'end',
					},
				},
				deps,
			);
			assert.match(output, /autolayout section/);
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

		test('buddy_workflow_run timeout preserves execution id and last known status', async () => {
			const originalNow = Date.now;
			let now = 0;
			Date.now = () => {
				now += 50_000;
				return now;
			};
			try {
				const { deps } = makeDeps({ pollStatus: 'running' });
				const output = await runWorkflowTool(
					{
						tool: WORKFLOW_RUN_TOOL_NAME,
						args: { workflowId: 'wf-1', workflowName: 'Sample', orgId: 'org-1', orgName: 'Acme' },
					},
					deps,
				);
				assert.match(output, /exec-new/, 'execution id is preserved');
				assert.match(output, /Still running/i, 'last known status is preserved');
			} finally {
				Date.now = originalNow;
			}
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

		test('buddy_execution_logs verifies an explicit orgId owns the execution before reading task logs', async () => {
			const { deps, calls } = makeDeps({
				executionOwnerOrgId: 'org-2',
				taskLogs: [{ originalWorkflowTaskName: 'other_org_task', status: 'succeeded' }],
			});

			await assert.rejects(
				() =>
					runWorkflowTool(
						{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1', orgId: 'org-1' } },
						deps,
					),
				/execution exec-1.*org org-1/i,
			);
			assert.ok(
				!calls.some(c => c.query.includes('RewstBuddyTaskLogs')),
				'task logs are not fetched until ownership is proven',
			);
		});

		test('buddy_execution_logs accepts a managing orgId by resolving the execution owner first', async () => {
			const { deps, calls } = makeDeps({
				executionOwnerOrgId: 'child-org',
				executionWorkflowOrgId: 'manager-org',
				executionManagingOrgId: 'manager-org',
				taskLogs: [{ originalWorkflowTaskName: 'managed_task', status: 'succeeded' }],
			});

			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', orgId: 'manager-org' },
				},
				deps,
			);

			assert.match(output, /managed_task: succeeded/);
			assert.ok(
				!calls.some(c => {
					const where = c.variables?.where as { id?: string; orgId?: string } | undefined;
					return (
						c.query.includes('RewstBuddyExecutions') &&
						where?.id === 'exec-1' &&
						where?.orgId === 'manager-org'
					);
				}),
				'execution ownership is resolved from the execution id instead of filtering by the URL org',
			);
		});

		test('buddy_execution_logs tries alternates when the primary session errors', async () => {
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyExecutions')) {
						return { data: { workflowExecutions: [{ id: (variables?.where as { id: string }).id }] } };
					}
					if (query.includes('RewstBuddyTaskLogs')) throw new Error('primary stale');
					return { data: {} };
				},
			};
			deps.alternates = [
				{
					isEnabled: () => true,
					confirmMutation: async () => true,
					execute: async (query, variables) => {
						if (query.includes('RewstBuddyExecutions')) {
							return { data: { workflowExecutions: [{ id: (variables?.where as { id: string }).id }] } };
						}
						if (query.includes('RewstBuddyTaskLogs')) {
							return {
								data: { taskLogs: [{ originalWorkflowTaskName: 'do_thing', status: 'succeeded' }] },
							};
						}
						return { data: {} };
					},
				},
			];

			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);

			assert.match(output, /do_thing: succeeded/);
			assert.match(output, /another active session/i);
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
			assert.strictEqual(spec.args, JSON.stringify(spec.inputSchema));
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

		test('buddy_execution_logs marks tasks that spawned sub-workflow executions', async () => {
			const { deps } = makeDeps({
				taskLogs: [
					{ originalWorkflowTaskName: 'call_sub', status: 'succeeded', taskExecutionId: 'te-1' },
					{ originalWorkflowTaskName: 'plain', status: 'succeeded', taskExecutionId: 'te-2' },
				],
				childExecutions: [
					{
						id: 'exec-child',
						status: 'succeeded',
						createdAt: '1500',
						parentTaskExecutionId: 'te-1',
						workflow: { id: 'wf-sub', name: 'Sub Flow' },
					},
				],
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /call_sub: succeeded/);
			assert.match(
				output,
				/sub-execution: Sub Flow \(exec-child, succeeded\)/,
				'the spawning task names its child execution',
			);
			const annotations = output.split('\n').filter(line => line.startsWith('    sub-execution:'));
			assert.strictEqual(annotations.length, 1, 'only the spawning task is marked, not plain tasks');
			assert.match(output, /1 sub-workflow execution\(s\)/, 'the summary counts spawned children');
			assert.match(output, /includeSubExecutions/, 'the summary names the drill-down option');
		});

		test('buddy_execution_logs lists sub-executions it cannot tie to a task', async () => {
			const { deps } = makeDeps({
				taskLogs: [{ originalWorkflowTaskName: 'start', status: 'succeeded' }],
				childExecutions: [
					{
						id: 'exec-orphan',
						status: 'running',
						createdAt: '1500',
						parentTaskExecutionId: null,
						workflow: { id: 'wf-sub', name: 'Sub Flow' },
					},
				],
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /Sub Flow \(exec-orphan, running\)/, 'unmatched children are still listed');
		});

		test('buddy_execution_logs keeps task logs when the sub-execution lookup fails', async () => {
			const { deps } = makeDeps({
				taskLogs: [{ originalWorkflowTaskName: 'start', status: 'succeeded' }],
				childExecutionsError: 'resolver broke',
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /start: succeeded/, 'the primary task logs still come back');
			assert.match(output, /[Ss]ub-workflow executions could not be checked/);
		});

		test('buddy_execution_logs includeSubExecutions inlines child task logs', async () => {
			const { deps } = makeDeps({
				taskLogs: [{ originalWorkflowTaskName: 'call_sub', status: 'succeeded', taskExecutionId: 'te-1' }],
				childExecutions: [
					{
						id: 'exec-child',
						status: 'failed',
						createdAt: '1500',
						parentTaskExecutionId: 'te-1',
						workflow: { id: 'wf-sub', name: 'Sub Flow' },
					},
				],
				taskLogsByExecution: {
					'exec-child': [
						{
							originalWorkflowTaskName: 'inner_task',
							status: 'failed',
							message: 'inner boom',
							input: {},
							result: {},
						},
					],
				},
			});
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: true },
				},
				deps,
			);
			assert.match(output, /Sub-execution Sub Flow \(exec-child, failed\):/);
			assert.match(output, /inner_task: failed/);
			assert.match(output, /inner boom/);
		});

		test('buddy_execution_logs failedOnly still surfaces sub-execution ids for hidden tasks', async () => {
			const { deps } = makeDeps({
				taskLogs: [
					{ originalWorkflowTaskName: 'call_sub', status: 'succeeded', taskExecutionId: 'te-1' },
					{ originalWorkflowTaskName: 'broken', status: 'failed', message: 'boom', input: {}, result: {} },
				],
				childExecutions: [
					{
						id: 'exec-child',
						status: 'failed',
						createdAt: '1500',
						parentTaskExecutionId: 'te-1',
						workflow: { id: 'wf-sub', name: 'Sub Flow' },
					},
				],
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1', failedOnly: true } },
				deps,
			);
			assert.ok(!output.includes('call_sub:'), 'the succeeded spawning task itself stays hidden');
			assert.match(
				output,
				/Sub Flow \(exec-child, failed\)/,
				"a hidden task's child execution id is still listed in the footer",
			);
		});

		test('buddy_execution_logs accepts includeSubExecutions as the string "true"', async () => {
			const { deps } = makeDeps({
				taskLogs: [{ originalWorkflowTaskName: 'call_sub', status: 'succeeded', taskExecutionId: 'te-1' }],
				childExecutions: [
					{
						id: 'exec-child',
						status: 'succeeded',
						createdAt: '1500',
						parentTaskExecutionId: 'te-1',
						workflow: { id: 'wf-sub', name: 'Sub Flow' },
					},
				],
				taskLogsByExecution: {
					'exec-child': [{ originalWorkflowTaskName: 'inner_task', status: 'succeeded' }],
				},
			});
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: 'true' },
				},
				deps,
			);
			assert.match(output, /Sub-execution Sub Flow \(exec-child, succeeded\):/, 'string flags are coerced');
		});

		test('buddy_execution_logs fetches sub-executions from the session that saw the rows', async () => {
			const primaryCalls: string[] = [];
			const primary: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async query => {
					primaryCalls.push(query);
					if (query.includes('RewstBuddyTaskLogs')) return { data: { taskLogs: [] } };
					return { data: {} };
				},
			};
			const alternateCalls: string[] = [];
			const alternate: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async query => {
					alternateCalls.push(query);
					if (query.includes('RewstBuddyTaskLogs')) {
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'call_sub',
										status: 'succeeded',
										taskExecutionId: 'te-1',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						return {
							data: {
								workflowExecution: {
									id: 'exec-1',
									childExecutions: [
										{
											id: 'exec-child',
											status: 'succeeded',
											parentTaskExecutionId: 'te-1',
											workflow: { id: 'wf-sub', name: 'Sub Flow' },
										},
									],
								},
							},
						};
					}
					return { data: {} };
				},
			};
			primary.alternates = [alternate];
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1' } },
				primary,
			);
			assert.match(output, /sub-execution: Sub Flow \(exec-child, succeeded\)/);
			assert.ok(
				!primaryCalls.some(q => q.includes('RewstBuddyChildExecutions')),
				'the primary session is not asked for children it cannot see',
			);
			assert.ok(
				alternateCalls.some(q => q.includes('RewstBuddyChildExecutions')),
				'children come from the session that produced the rows',
			);
		});

		test('buddy_execution_logs caps how many sub-executions it inlines', async () => {
			const children = Array.from({ length: 6 }, (_, i) => ({
				id: `exec-c${i}`,
				status: 'succeeded',
				parentTaskExecutionId: null,
				workflow: { id: 'wf-sub', name: `Sub ${i}` },
			}));
			const { deps } = makeDeps({
				taskLogs: [{ originalWorkflowTaskName: 'start', status: 'succeeded' }],
				childExecutions: children,
				taskLogsByExecution: Object.fromEntries(
					children.map(c => [c.id, [{ originalWorkflowTaskName: 'inner', status: 'succeeded' }]]),
				),
			});
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: true },
				},
				deps,
			);
			const inlined = output.split('\n').filter(line => /^Sub-execution Sub \d/.test(line)).length;
			assert.strictEqual(inlined, 5, 'only the first five children are inlined');
			assert.match(output, /1 more sub-execution\(s\) not inlined/);
		});

		test('buddy_execution_logs starts inline sub-execution task-log reads in parallel', async () => {
			const started: string[] = [];
			const resolvers: ((rows: unknown[]) => void)[] = [];
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						const where = (variables?.where ?? {}) as { workflowExecutionId?: string };
						if (where.workflowExecutionId === 'exec-1') {
							return {
								data: {
									taskLogs: [
										{
											originalWorkflowTaskName: 'call_sub',
											status: 'succeeded',
											taskExecutionId: 'te-1',
										},
									],
								},
							};
						}
						started.push(where.workflowExecutionId ?? '');
						return new Promise(resolve => {
							resolvers.push((rows: unknown[]) => resolve({ data: { taskLogs: rows } }));
						});
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						return {
							data: {
								workflowExecution: {
									id: 'exec-1',
									childExecutions: [
										{
											id: 'exec-a',
											status: 'succeeded',
											parentTaskExecutionId: 'te-1',
											workflow: { id: 'wf-a', name: 'Sub A' },
										},
										{
											id: 'exec-b',
											status: 'succeeded',
											parentTaskExecutionId: 'te-1',
											workflow: { id: 'wf-b', name: 'Sub B' },
										},
									],
								},
							},
						};
					}
					return { data: {} };
				},
			};

			const outputPromise = runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: true },
				},
				deps,
			);
			await flushMicrotasks();

			let startupFailure: unknown;
			try {
				assert.deepStrictEqual(
					started,
					['exec-a', 'exec-b'],
					'both child log reads start before either child response resolves',
				);
			} catch (error) {
				startupFailure = error;
			}

			resolvers
				.splice(0)
				.forEach((resolve, index) =>
					resolve([{ originalWorkflowTaskName: index === 0 ? 'inner_a' : 'inner_b', status: 'succeeded' }]),
				);
			await flushMicrotasks();
			resolvers
				.splice(0)
				.forEach(resolve => resolve([{ originalWorkflowTaskName: 'inner_b', status: 'succeeded' }]));
			const output = await outputPromise;
			if (startupFailure) throw startupFailure;

			assert.ok(output.indexOf('Sub-execution Sub A') < output.indexOf('Sub-execution Sub B'));
			assert.match(output, /inner_a: succeeded/);
			assert.match(output, /inner_b: succeeded/);
		});

		test('buddy_execution_logs notes a child whose task logs cannot be read', async () => {
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						const where = (variables?.where ?? {}) as { workflowExecutionId?: string };
						if (where.workflowExecutionId === 'exec-child') throw new Error('child hidden');
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'call_sub',
										status: 'succeeded',
										taskExecutionId: 'te-1',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						return {
							data: {
								workflowExecution: {
									id: 'exec-1',
									childExecutions: [
										{
											id: 'exec-child',
											status: 'succeeded',
											parentTaskExecutionId: 'te-1',
											workflow: { id: 'wf-sub', name: 'Sub Flow' },
										},
									],
								},
							},
						};
					}
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: true },
				},
				deps,
			);
			assert.match(output, /call_sub: succeeded/, 'parent logs survive the child read failure');
			assert.match(output, /task logs could not be read \(child hidden\)/);
		});

		test('buddy_execution_logs default depth fetches only direct children', async () => {
			const childFetchIds: string[] = [];
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'root_task',
										status: 'succeeded',
										taskExecutionId: 'te-1',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						childFetchIds.push(where.id ?? '?');
						if (where.id === 'exec-1') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-1',
										childExecutions: [
											{
												id: 'exec-child',
												status: 'succeeded',
												parentTaskExecutionId: 'te-1',
												workflow: { id: 'wf-sub', name: 'Sub Flow' },
											},
										],
									},
								},
							};
						}
						// exec-child has its own grandchild — should NOT be fetched at depth 1
						return {
							data: {
								workflowExecution: {
									id: where.id,
									childExecutions: [
										{
											id: 'exec-grand',
											status: 'succeeded',
											parentTaskExecutionId: 'te-child',
											workflow: { id: 'wf-grand', name: 'Grand Flow' },
										},
									],
								},
							},
						};
					}
					return { data: {} };
				},
			};
			await runWorkflowTool({ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1' } }, deps);
			// Only the root fetch should have happened — no grandchild fetch
			assert.deepStrictEqual(childFetchIds, ['exec-1'], 'default depth=1 fetches only the root children');
		});

		test('buddy_execution_logs depth 2 lists grandchildren under their parent', async () => {
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'root_task',
										status: 'succeeded',
										taskExecutionId: 'te-1',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						if (where.id === 'exec-1') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-1',
										childExecutions: [
											{
												id: 'exec-child',
												status: 'succeeded',
												parentTaskExecutionId: 'te-1',
												workflow: { id: 'wf-sub', name: 'Child Flow' },
											},
										],
									},
								},
							};
						}
						if (where.id === 'exec-child') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-child',
										childExecutions: [
											{
												id: 'exec-grand',
												status: 'failed',
												parentTaskExecutionId: 'te-child',
												workflow: { id: 'wf-grand', name: 'Grand Flow' },
											},
										],
									},
								},
							};
						}
						return { data: { workflowExecution: { id: where.id, childExecutions: [] } } };
					}
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1', depth: 2 } },
				deps,
			);
			assert.match(output, /Nested sub-executions \(depth 2\)/, 'nested section header present');
			assert.match(output, /Grand Flow.*exec-grand/, 'grandchild listed');
			assert.match(output, /parent execution exec-child/, 'grandchild references its parent execution id');
		});

		test('buddy_execution_logs depth walk appends a note for a per-node fetch error instead of silently stopping', async () => {
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'root_task',
										status: 'succeeded',
										taskExecutionId: 'te-1',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						if (where.id === 'exec-1') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-1',
										childExecutions: [
											{
												id: 'exec-child',
												status: 'succeeded',
												parentTaskExecutionId: 'te-1',
												workflow: { id: 'wf-sub', name: 'Child Flow' },
											},
										],
									},
								},
							};
						}
						// Fetching exec-child's own children fails.
						return { errors: [{ message: 'boom: transient GraphQL error' }] };
					}
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1', depth: 2 } },
				deps,
			);
			assert.match(output, /Child Flow.*exec-child/, 'the level-1 child that failed to expand is still listed');
			assert.match(
				output,
				/could not fetch children of sub-execution exec-child.*boom: transient GraphQL error/,
				'the per-node fetch error is appended as a note rather than silently treated as no children',
			);
		});

		test('buddy_execution_logs depth is clamped: non-numeric and 0 fall back to 1, 99 is capped at 5', async () => {
			const childFetchCounts: Record<string, number> = {};
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						return {
							data: {
								taskLogs: [
									{ originalWorkflowTaskName: 't', status: 'succeeded', taskExecutionId: 'te-1' },
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						const id = where.id ?? '?';
						childFetchCounts[id] = (childFetchCounts[id] ?? 0) + 1;
						// Each execution has one child, creating a deep chain
						const childId = `exec-${id}-child`;
						return {
							data: {
								workflowExecution: {
									id,
									childExecutions: [
										{
											id: childId,
											status: 'succeeded',
											parentTaskExecutionId: 'te-1',
											workflow: { id: 'wf-x', name: 'X' },
										},
									],
								},
							},
						};
					}
					return { data: {} };
				},
			};
			// depth=99 should be capped at 5, so at most 5 total fetches (levels 1..5)
			await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1', depth: 99 } },
				deps,
			);
			const totalFetches = Object.values(childFetchCounts).reduce((a, b) => a + b, 0);
			assert.ok(totalFetches <= 5, `depth 99 capped at 5; got ${totalFetches} fetches`);
		});

		test('buddy_execution_logs fetch cap truncation is stated in output', async () => {
			// Root has 30 children; with depth:2 the BFS would try to fetch each child's children,
			// hitting the MAX_SUB_EXECUTION_FETCHES=25 cap.
			const rootChildren = Array.from({ length: 30 }, (_, i) => ({
				id: `exec-child-${i}`,
				status: 'succeeded',
				parentTaskExecutionId: 'te-1',
				workflow: { id: `wf-${i}`, name: `Child ${i}` },
			}));
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						return {
							data: {
								taskLogs: [
									{ originalWorkflowTaskName: 't', status: 'succeeded', taskExecutionId: 'te-1' },
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						if (where.id === 'exec-1') {
							return { data: { workflowExecution: { id: 'exec-1', childExecutions: rootChildren } } };
						}
						// Each child also has a grandchild
						return {
							data: {
								workflowExecution: {
									id: where.id,
									childExecutions: [
										{
											id: `${where.id}-grand`,
											status: 'succeeded',
											parentTaskExecutionId: 'te-x',
											workflow: { id: 'wf-g', name: 'Grand' },
										},
									],
								},
							},
						};
					}
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, args: { executionId: 'exec-1', depth: 2 } },
				deps,
			);
			assert.match(output, /truncated at 25 fetches/, 'truncation note appears when fetch cap is hit');
		});

		test('buddy_execution_logs includeSubExecutions with depth 2 inlines the grandchild task log too', async () => {
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						const where = (variables?.where ?? {}) as { workflowExecutionId?: string };
						if (where.workflowExecutionId === 'exec-child') {
							return {
								data: {
									taskLogs: [
										{
											originalWorkflowTaskName: 'child_task',
											status: 'succeeded',
											taskExecutionId: 'te-child',
										},
									],
								},
							};
						}
						if (where.workflowExecutionId === 'exec-grand') {
							return {
								data: {
									taskLogs: [
										{
											originalWorkflowTaskName: 'grand_task',
											status: 'failed',
											message: 'grand boom',
											input: {},
											result: {},
										},
									],
								},
							};
						}
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'root_task',
										status: 'succeeded',
										taskExecutionId: 'te-1',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						if (where.id === 'exec-1') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-1',
										childExecutions: [
											{
												id: 'exec-child',
												status: 'succeeded',
												parentTaskExecutionId: 'te-1',
												workflow: { id: 'wf-sub', name: 'Child Flow' },
											},
										],
									},
								},
							};
						}
						if (where.id === 'exec-child') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-child',
										childExecutions: [
											{
												id: 'exec-grand',
												status: 'failed',
												parentTaskExecutionId: 'te-child',
												workflow: { id: 'wf-grand', name: 'Grand Flow' },
											},
										],
									},
								},
							};
						}
						return { data: { workflowExecution: { id: where.id, childExecutions: [] } } };
					}
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: true, depth: 2 },
				},
				deps,
			);
			assert.match(output, /Sub-execution Child Flow \(exec-child, succeeded\):/, 'level 1 child is inlined');
			assert.match(output, /child_task: succeeded/, "level 1 child's own task log is inlined");
			assert.match(
				output,
				/Sub-execution Grand Flow \(exec-grand, failed\) \(level 2, parent execution exec-child\):/,
				'level 2 grandchild is inlined and labeled with its level and parent',
			);
			assert.match(output, /grand_task: failed/, "the grandchild's own task name shows up, not just its id");
			assert.match(output, /grand boom/, "the grandchild's own failure message is inlined, not just listed");
		});

		test('buddy_execution_logs includeSubExecutions with depth respects the per-level inline cap and total fetch budget', async () => {
			// Each execution has 10 children, more than MAX_INLINE_SUB_EXECUTIONS (5), and depth is deep
			// enough that the total fetch budget (25) is exhausted before the whole tree is walked.
			const makeChildren = (prefix: string) =>
				Array.from({ length: 10 }, (_, i) => ({
					id: `${prefix}-${i}`,
					status: 'succeeded',
					parentTaskExecutionId: 'te-1',
					workflow: { id: `wf-${prefix}-${i}`, name: `Flow ${prefix}-${i}` },
				}));
			const fetchCounts: Record<string, number> = {};
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						const where = (variables?.where ?? {}) as { workflowExecutionId?: string };
						const id = where.workflowExecutionId ?? 'root';
						fetchCounts[id] = (fetchCounts[id] ?? 0) + 1;
						return {
							data: {
								taskLogs: [
									{ originalWorkflowTaskName: 't', status: 'succeeded', taskExecutionId: 'te-1' },
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						const id = where.id ?? 'root';
						fetchCounts[id] = (fetchCounts[id] ?? 0) + 1;
						return { data: { workflowExecution: { id, childExecutions: makeChildren(id) } } };
					}
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: true, depth: 5 },
				},
				deps,
			);
			const totalFetches = Object.values(fetchCounts).reduce((a, b) => a + b, 0);
			// MAX_SUB_EXECUTION_FETCHES (25) bounds the walk's own fetches; the root's unconditional
			// task-log fetch and its unconditional child-execution lookup are not drawn from that budget
			// (same as the pre-existing depth-only BFS walk), so the hard ceiling is 25 + 1.
			assert.ok(totalFetches <= 26, `total fetches must stay within the shared budget; got ${totalFetches}`);
			const inlinedSections = output.split('\n').filter(line => /^Sub-execution Flow /.test(line)).length;
			assert.ok(
				inlinedSections <= 5 * 5,
				`no more than MAX_INLINE_SUB_EXECUTIONS per level across up to 5 levels; got ${inlinedSections}`,
			);
			assert.match(
				output,
				/truncated at 25 fetches/,
				'truncation is stated in the output when the budget is hit',
			);
			assert.match(
				output,
				/more sub-execution\(s\) not inlined/,
				'the skip-count footer states how many siblings past the per-level cap were not inlined',
			);
		});

		test('buddy_execution_logs includeSubExecutions notes a footer error when fetching grandchildren fails', async () => {
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'root_task',
										status: 'succeeded',
										taskExecutionId: 'te-1',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						if (where.id === 'exec-1') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-1',
										childExecutions: [
											{
												id: 'exec-child',
												status: 'succeeded',
												parentTaskExecutionId: 'te-1',
												workflow: { id: 'wf-sub', name: 'Child Flow' },
											},
										],
									},
								},
							};
						}
						if (where.id === 'exec-child') {
							return { errors: [{ message: 'grandchild lookup boom' }] };
						}
						return { data: { workflowExecution: { id: where.id, childExecutions: [] } } };
					}
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: true, depth: 2 },
				},
				deps,
			);
			assert.match(
				output,
				/Sub-execution Child Flow \(exec-child, succeeded\):/,
				'level 1 child is still inlined',
			);
			assert.match(
				output,
				/could not fetch children of sub-execution exec-child.*grandchild lookup boom/,
				'the fetch-error footer note surfaces the failure to fetch grandchildren',
			);
		});

		test('buddy_execution_logs with includeSubExecutions:false and depth:2 stays id-only (flags stay independent)', async () => {
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'root_task',
										status: 'succeeded',
										taskExecutionId: 'te-1',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						if (where.id === 'exec-1') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-1',
										childExecutions: [
											{
												id: 'exec-child',
												status: 'succeeded',
												parentTaskExecutionId: 'te-1',
												workflow: { id: 'wf-sub', name: 'Child Flow' },
											},
										],
									},
								},
							};
						}
						if (where.id === 'exec-child') {
							return {
								data: {
									workflowExecution: {
										id: 'exec-child',
										childExecutions: [
											{
												id: 'exec-grand',
												status: 'failed',
												parentTaskExecutionId: 'te-child',
												workflow: { id: 'wf-grand', name: 'Grand Flow' },
											},
										],
									},
								},
							};
						}
						return { data: { workflowExecution: { id: where.id, childExecutions: [] } } };
					}
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{
					tool: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
					args: { executionId: 'exec-1', includeSubExecutions: false, depth: 2 },
				},
				deps,
			);
			assert.match(output, /Nested sub-executions \(depth 2\)/, 'old id-only nested section header present');
			assert.match(output, /Grand Flow.*exec-grand/, 'grandchild listed by id/workflow/status only');
			assert.match(output, /parent execution exec-child/, 'grandchild references its parent execution id');
			assert.ok(!output.includes('Sub-execution Grand Flow'), 'no inlined task log for the grandchild');
			assert.ok(!output.includes('Sub-execution Child Flow'), 'no inlined task log for the child either');
		});

		test('buddy_execution_logs spec documents sub-execution visibility and includeSubExecutions', () => {
			const spec = WORKFLOW_TOOL_SPECS.find(tool => tool.name === WORKFLOW_EXECUTION_LOGS_TOOL_NAME);
			assert.ok(spec, 'buddy_execution_logs spec exists');
			assert.strictEqual(spec.args, JSON.stringify(spec.inputSchema));
			assert.match(spec.description, /sub-workflow/i, 'description explains sub-workflow visibility');
			assert.match(spec.description, /includeSubExecutions/);
			assert.match(spec.description, /depth/, 'description mentions depth param');
			const props = (spec.inputSchema as { properties: Record<string, unknown> }).properties;
			assert.ok('includeSubExecutions' in props, 'inputSchema declares includeSubExecutions');
			assert.ok('depth' in props, 'inputSchema declares depth');
		});

		test('buddy_workflow_search indexes every accessible org and shows the org name', async () => {
			const { deps } = makeDeps();
			const out = await runWorkflowTool({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'onboarding' } }, deps);
			assert.match(out, /Onboarding {2}\(id: wf-aaa\) {2}org: Primary Org \(org-1\)/);
			assert.match(out, /Acme Onboarding {2}\(id: wf-ccc\) {2}org: Acme Corp \(org-2\)/);
			assert.ok(!out.includes('Offboarding'), 'only the matching workflows are listed');
			assert.match(out, /across 2 org/, 'reports how many orgs were indexed');
			assert.match(out, /orgs with indexed workflows: Primary Org \(org-1\), Acme Corp \(org-2\)/);
		});

		test('buddy_workflow_search names a requested org that has no workflows in the index', async () => {
			const { deps } = makeDeps();
			const out = await runWorkflowTool(
				{ tool: WORKFLOW_SEARCH_TOOL_NAME, args: { query: 'onboarding', orgId: 'org-empty' } },
				deps,
			);
			assert.match(out, /No matches/);
			assert.match(
				out,
				/org-empty has no workflows in the index/,
				'a zero-match against an absent org is explained, not left ambiguous',
			);
			assert.match(out, /no workflows.*or this session cannot see it/i);
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

	suite('buddy_workflow_diagnose', () => {
		function makeDiagnoseDeps(
			over: Partial<{
				taskLogs: unknown[];
				findExecutions: unknown[];
				childExecutions: unknown[];
				childExecutionsWorkflow: { id: string; name: string; orgId: string } | null;
				childExecutionsOrgId: string;
				childExecutionsManagingOrgId: string;
				childExecutionsError: string;
				workflow: unknown;
				workflowError: string;
				contexts: Record<string, unknown>[];
				contextsError: string;
			}> = {},
		): { deps: GraphqlToolDeps; calls: { query: string; variables?: Record<string, unknown> }[] } {
			const calls: { query: string; variables?: Record<string, unknown> }[] = [];
			const execute: GraphqlToolDeps['execute'] = async (query, variables) => {
				calls.push({ query, variables });
				if (query.includes('RewstBuddyTaskLogs')) return { data: { taskLogs: over.taskLogs ?? [] } };
				if (query.includes('RewstBuddyExecutionDetail')) {
					const where = (variables?.where ?? {}) as { id?: string };
					const ownerOrgId = over.childExecutionsOrgId ?? 'org-1';
					const workflow =
						over.childExecutionsWorkflow === null
							? null
							: (over.childExecutionsWorkflow ?? { id: 'wf-1', name: 'Sample', orgId: ownerOrgId });
					return {
						data: {
							workflowExecution: {
								id: where.id,
								status: 'FAILED',
								orgId: ownerOrgId,
								organization: {
									id: ownerOrgId,
									managingOrgId: over.childExecutionsManagingOrgId,
								},
								workflow,
							},
						},
					};
				}
				if (query.includes('RewstBuddyExecutions')) {
					return { data: { workflowExecutions: over.findExecutions ?? [] } };
				}
				if (query.includes('RewstBuddyChildExecutions')) {
					if (over.childExecutionsError) return { errors: [{ message: over.childExecutionsError }] };
					return {
						data: {
							workflowExecution: {
								id: 'exec-1',
								status: 'FAILED',
								orgId: over.childExecutionsOrgId,
								organization: {
									id: over.childExecutionsOrgId,
									managingOrgId: over.childExecutionsManagingOrgId,
								},
								workflow: over.childExecutionsWorkflow,
								childExecutions: over.childExecutions ?? [],
							},
						},
					};
				}
				if (query.includes('RewstBuddyWorkflowGet')) {
					if (over.workflowError) return { errors: [{ message: over.workflowError }] };
					return { data: { workflow: over.workflow } };
				}
				if (query.includes('RewstBuddyExecutionContexts')) {
					if (over.contextsError) return { errors: [{ message: over.contextsError }] };
					return { data: { workflowExecutionContexts: over.contexts ?? [{ some_key: 1 }] } };
				}
				return { data: {} };
			};
			const deps: GraphqlToolDeps = { isEnabled: () => true, confirmMutation: async () => true, execute };
			return { deps, calls };
		}

		const diagnoseWorkflow = (): RawWorkflow => ({
			...sampleWorkflow(),
			tasks: [
				{
					id: 'task-a',
					name: 'start',
					actionId: 'noop-id',
					action: { ref: 'core.noop' },
					input: {},
					next: [{ when: '{{ SUCCEEDED }}', do: ['task-b'] }],
				},
				{
					id: 'task-b',
					name: 'the_failer',
					actionId: 'noop-id',
					action: { ref: 'core.http' },
					input: {},
					next: [{ when: '{{ SUCCEEDED }}', do: [] }],
				},
			],
		});

		const failingTaskLogs = [
			{ originalWorkflowTaskName: 'start', status: 'succeeded' },
			{
				originalWorkflowTaskName: 'the_failer',
				status: 'failed',
				message: 'boom',
				input: { x: 1 },
				result: { e: 1 },
				taskExecutionId: 'te-1',
			},
		];

		test('finds the earliest failing task and its transition path', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutionsWorkflow: { id: 'wf-1', name: 'Sample', orgId: 'org-1' },
				childExecutionsOrgId: 'org-1',
				workflow: diagnoseWorkflow(),
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /the_failer: failed/);
			assert.match(output, /message: boom/);
			assert.match(output, /Transition path/);
			assert.match(output, /in:\s+start --\[\{\{ SUCCEEDED \}\}\]--> the_failer/);
			assert.match(output, /out:\s+\(none — terminal task\)/);
		});

		test('includes publish expressions on the transition path', async () => {
			const workflow = diagnoseWorkflow();
			workflow.tasks[0].next = [
				{
					when: '{{ SUCCEEDED }}',
					do: ['task-b'],
					publish: [{ key: 'customer_org_id', value: '{{ RESULT.result.org_id }}' }],
				},
			];
			const { deps } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutionsWorkflow: { id: 'wf-1', name: 'Sample', orgId: 'org-1' },
				childExecutionsOrgId: 'org-1',
				workflow,
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(
				output,
				/in:\s+start --\[\{\{ SUCCEEDED \}\}\]--> the_failer \(publish: customer_org_id=\{\{ RESULT\.result\.org_id \}\}\)/,
			);
		});

		test('includes a full executed path reconstructed from task logs and graph transitions', async () => {
			const workflow = diagnoseWorkflow();
			workflow.tasks.splice(1, 0, {
				id: 'task-mid',
				name: 'normalize',
				actionId: 'noop-id',
				action: { ref: 'core.transform' },
				input: {},
				next: [
					{
						when: '{{ CTX.ready }}',
						do: ['task-b'],
						publish: [{ key: 'normalized_id', value: '{{ RESULT.result.id }}' }],
					},
				],
			});
			workflow.tasks[0].next = [{ when: '{{ SUCCEEDED }}', do: ['task-mid'] }];
			const { deps } = makeDiagnoseDeps({
				taskLogs: [
					{
						originalWorkflowTaskName: 'the_failer',
						status: 'failed',
						createdAt: '3000',
						message: 'boom',
						input: {},
						result: {},
					},
					{ originalWorkflowTaskName: 'start', status: 'succeeded', createdAt: '1000' },
					{ originalWorkflowTaskName: 'normalize', status: 'succeeded', createdAt: '2000' },
				],
				childExecutionsWorkflow: { id: 'wf-1', name: 'Sample', orgId: 'org-1' },
				childExecutionsOrgId: 'org-1',
				workflow,
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /Executed path/);
			assert.match(output, /1\. start\s+succeeded\s+1970-01-01T00:00:01\.000Z/);
			assert.match(output, /2\. normalize\s+succeeded\s+1970-01-01T00:00:02\.000Z/);
			assert.match(output, /via start --\[\{\{ SUCCEEDED \}\}\]--> normalize/);
			assert.match(output, /3\. the_failer\s+failed\s+1970-01-01T00:00:03\.000Z/);
			assert.match(
				output,
				/via normalize --\[\{\{ CTX\.ready \}\}\]--> the_failer \(publish: normalized_id=\{\{ RESULT\.result\.id \}\}\)/,
			);
		});

		test('treats missing or empty createdAt values as unknown timestamps', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: [
					{ originalWorkflowTaskName: 'start', status: 'succeeded', createdAt: '1000' },
					{ originalWorkflowTaskName: 'normalize', status: 'succeeded', createdAt: '' },
					{ originalWorkflowTaskName: 'the_failer', status: 'failed' },
				],
				childExecutionsWorkflow: { id: 'wf-1', name: 'Sample', orgId: 'org-1' },
				childExecutionsOrgId: 'org-1',
				workflow: diagnoseWorkflow(),
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /1\. start\s+succeeded\s+1970-01-01T00:00:01\.000Z/);
			assert.match(output, /2\. normalize\s+succeeded\s+\?/);
			assert.match(output, /3\. the_failer\s+failed\s+\?/);
			assert.ok(!output.includes('1970-01-01T00:00:00.000Z'), 'empty timestamps do not become epoch zero');
		});

		test('diagnoses by workflowId when executionId is unknown', async () => {
			const { deps, calls } = makeDiagnoseDeps({
				findExecutions: [{ id: 'exec-9', status: 'FAILED', createdAt: '1000' }],
				taskLogs: failingTaskLogs,
				childExecutionsWorkflow: { id: 'wf-1', name: 'Sample', orgId: 'org-1' },
				childExecutionsOrgId: 'org-1',
				workflow: diagnoseWorkflow(),
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { workflowId: 'wf-1', orgId: 'org-1' } },
				deps,
			);
			assert.match(output, /exec-9/);
			assert.match(output, /the_failer: failed/);
			const execCall = calls.find(c => c.query.includes('RewstBuddyExecutions'));
			assert.ok(execCall, 'made a RewstBuddyExecutions call');
			assert.deepStrictEqual((execCall.variables as { where?: unknown })?.where, {
				workflowId: 'wf-1',
				orgId: 'org-1',
				status: 'FAILED',
			});
		});

		test('fetches the workflow definition from the workflow org when execution owner is a child org', async () => {
			const { deps, calls } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutionsOrgId: 'child-org',
				childExecutionsManagingOrgId: 'manager-org',
				childExecutionsWorkflow: { id: 'wf-1', name: 'Sample', orgId: 'manager-org' },
				workflow: diagnoseWorkflow(),
				contexts: [{ some_key: 1 }],
			});

			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);

			assert.match(output, /Transition path/);
			const workflowCall = calls.find(c => c.query.includes('RewstBuddyWorkflowGet'));
			assert.ok(workflowCall, 'workflow definition was fetched');
			assert.strictEqual((workflowCall.variables?.where as { orgId?: string } | undefined)?.orgId, 'manager-org');
		});

		test('reports no failed executions for a workflow instead of erroring', async () => {
			const { deps, calls } = makeDiagnoseDeps({ findExecutions: [] });
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { workflowId: 'wf-1', orgId: 'org-1' } },
				deps,
			);
			assert.match(output, /No FAILED executions found for workflow wf-1/);
			assert.ok(!calls.some(c => c.query.includes('RewstBuddyTaskLogs')), 'no task log query fired');
		});

		test('requires orgId together with workflowId', async () => {
			const { deps } = makeDiagnoseDeps();
			await assert.rejects(
				() => runWorkflowTool({ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { workflowId: 'wf-1' } }, deps),
				/requires "orgId" together with "workflowId"/,
			);
		});

		test('requires executionId or workflowId', async () => {
			const { deps } = makeDiagnoseDeps();
			await assert.rejects(
				() => runWorkflowTool({ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: {} }, deps),
				/requires "executionId", or "workflowId"/,
			);
		});

		test('reports no failing task when the execution succeeded', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: [{ originalWorkflowTaskName: 'start', status: 'succeeded' }],
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /No failing task found/);
			assert.ok(!output.includes('Transition path'), 'no transition path section for a non-failing run');
			assert.ok(!/Execution context/i.test(output), 'execution context is not fetched after a non-failing run');
		});

		test('flags a failed child execution as the likely deeper cause', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutions: [
					{
						id: 'exec-child',
						status: 'failed',
						parentTaskExecutionId: 'te-1',
						workflow: { id: 'wf-sub', name: 'Sub Flow' },
					},
				],
				childExecutionsOrgId: 'org-1',
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /Likely deeper cause/);
			assert.match(output, /exec-child/);
			assert.match(output, /buddy_workflow_diagnose \{"executionId": "exec-child"\}/);
		});

		test('lists sub-executions not tied to the failing task separately', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutions: [
					{
						id: 'exec-orphan',
						status: 'running',
						parentTaskExecutionId: null,
						workflow: { id: 'wf-sub', name: 'Sub Flow' },
					},
				],
				childExecutionsOrgId: 'org-1',
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /Other sub-workflow execution/);
			assert.match(output, /exec-orphan/);
			assert.ok(!output.includes('Likely deeper cause'), 'orphan is not described as the deeper cause');
		});

		test('includes the merged execution context top-level keys', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutionsOrgId: 'org-1',
				contexts: [{ a: 1 }, { b: 2 }],
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /top-level keys: a, b/);
			assert.match(output, /merged from 2 snapshot\(s\)/);
		});

		test('treats only the earliest failing row as the root cause when a later task also failed', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: [...failingTaskLogs, { originalWorkflowTaskName: 'downstream', status: 'failed' }],
				childExecutionsOrgId: 'org-1',
				workflow: diagnoseWorkflow(),
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /Failing task \(likely root cause\)[\s\S]*the_failer: failed/);
			const rootCauseSection = output.split('\n\n')[1] ?? '';
			assert.ok(!rootCauseSection.includes('downstream'), 'downstream failure is not the root cause section');
		});

		test('keeps the digest when the execution context lookup fails', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutionsOrgId: 'org-1',
				contextsError: 'context resolver broke',
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /the_failer: failed/);
			assert.match(output, /Execution context unavailable:.*context resolver broke/);
		});

		test('keeps the digest when the workflow definition fetch errors', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutionsWorkflow: { id: 'wf-1', name: 'Sample', orgId: 'org-1' },
				childExecutionsOrgId: 'org-1',
				workflowError: 'schema broke',
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /the_failer: failed/);
			assert.match(output, /Workflow definition unavailable:.*schema broke/);
		});

		test('omits the transition path section when no workflow or org is resolvable', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: failingTaskLogs,
				childExecutionsWorkflow: null,
				// no childExecutionsOrgId, no orgId arg
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /the_failer: failed/);
			assert.ok(!output.includes('Transition path'), 'no transition path when workflow/org unavailable');
		});

		test('verifies an explicit orgId owns the execution before reading task logs', async () => {
			const calls: { query: string; variables?: Record<string, unknown> }[] = [];
			const execute: GraphqlToolDeps['execute'] = async (query, variables) => {
				calls.push({ query, variables });
				if (query.includes('RewstBuddyExecutions')) return { data: { workflowExecutions: [] } };
				if (query.includes('RewstBuddyTaskLogs')) {
					throw new Error('task logs must not be read before org ownership is proven');
				}
				return { data: {} };
			};
			const deps: GraphqlToolDeps = { isEnabled: () => true, confirmMutation: async () => true, execute };

			await assert.rejects(
				() =>
					runWorkflowTool(
						{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1', orgId: 'org-1' } },
						deps,
					),
				/execution exec-1.*org org-1/i,
			);
			assert.ok(!calls.some(c => c.query.includes('RewstBuddyTaskLogs')), 'task logs were never queried');
		});

		test('sweeps alternate sessions when the primary sees no rows', async () => {
			const primaryCalls: string[] = [];
			const alternateCalls: string[] = [];
			const primaryExecute: GraphqlToolDeps['execute'] = async query => {
				primaryCalls.push(query);
				if (query.includes('RewstBuddyTaskLogs')) return { data: { taskLogs: [] } };
				if (query.includes('RewstBuddyChildExecutions'))
					return {
						data: {
							workflowExecution: {
								id: 'exec-1',
								status: 'FAILED',
								orgId: 'org-1',
								workflow: { id: 'wf-1', name: 'Sample', orgId: 'org-1' },
								childExecutions: [],
							},
						},
					};
				if (query.includes('RewstBuddyExecutionContexts'))
					return { data: { workflowExecutionContexts: [{ ctx_key: 1 }] } };
				return { data: {} };
			};
			const alternateExecute: GraphqlToolDeps['execute'] = async query => {
				alternateCalls.push(query);
				if (query.includes('RewstBuddyTaskLogs'))
					return {
						data: {
							taskLogs: [
								{
									originalWorkflowTaskName: 'alt_task',
									status: 'failed',
									message: 'alt error',
								},
							],
						},
					};
				return { data: {} };
			};
			const alternateDeps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: alternateExecute,
			};
			const primaryDeps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: primaryExecute,
				alternates: [alternateDeps],
			};
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				primaryDeps,
			);
			assert.match(output, /alt_task: failed/);
			assert.match(output, /found via another active session/i);
		});

		test('explains visibility when no session can see the execution', async () => {
			const emptyExecute: GraphqlToolDeps['execute'] = async query => {
				if (query.includes('RewstBuddyTaskLogs')) return { data: { taskLogs: [] } };
				if (query.includes('RewstBuddyChildExecutions'))
					return {
						data: {
							workflowExecution: {
								id: 'exec-1',
								status: null,
								orgId: null,
								workflow: null,
								childExecutions: [],
							},
						},
					};
				return { data: {} };
			};
			const alternateDeps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: emptyExecute,
			};
			const primaryDeps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: emptyExecute,
				alternates: [alternateDeps],
			};
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				primaryDeps,
			);
			assert.match(output, /None of the 2 active session\(s\) can see task logs/i);
		});

		test('buddy_workflow_diagnose auto-drills the failing chain with default depth', async () => {
			// root → failed child → failed grandchild; default depth=3 should inline both
			const taskLogsByExec: Record<string, unknown[]> = {
				'exec-1': [
					{
						originalWorkflowTaskName: 'root_task',
						status: 'failed',
						message: 'root boom',
						input: {},
						result: {},
						taskExecutionId: 'te-root',
					},
				],
				'exec-child': [
					{
						originalWorkflowTaskName: 'child_task',
						status: 'failed',
						message: 'child boom',
						input: {},
						result: {},
						taskExecutionId: 'te-child',
					},
				],
				'exec-grand': [
					{
						originalWorkflowTaskName: 'grand_task',
						status: 'failed',
						message: 'grand boom',
						input: {},
						result: {},
						taskExecutionId: 'te-grand',
					},
				],
			};
			const childrenByExec: Record<string, unknown[]> = {
				'exec-1': [
					{
						id: 'exec-child',
						status: 'failed',
						parentTaskExecutionId: 'te-root',
						workflow: { id: 'wf-child', name: 'Child WF' },
					},
				],
				'exec-child': [
					{
						id: 'exec-grand',
						status: 'failed',
						parentTaskExecutionId: 'te-child',
						workflow: { id: 'wf-grand', name: 'Grand WF' },
					},
				],
				'exec-grand': [],
			};
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						const where = (variables?.where ?? {}) as { workflowExecutionId?: string };
						return { data: { taskLogs: taskLogsByExec[where.workflowExecutionId ?? ''] ?? [] } };
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						return {
							data: {
								workflowExecution: {
									id: where.id,
									status: 'FAILED',
									orgId: 'org-1',
									workflow: { id: 'wf-1', name: 'Root WF', orgId: 'org-1' },
									childExecutions: childrenByExec[where.id ?? ''] ?? [],
								},
							},
						};
					}
					if (query.includes('RewstBuddyExecutionContexts'))
						return { data: { workflowExecutionContexts: [{}] } };
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /Nested diagnosis \(level 1/, 'level 1 nested section present');
			assert.match(output, /Nested diagnosis \(level 2/, 'level 2 nested section present');
			assert.ok(
				!output.includes('drill in with buddy_workflow_diagnose'),
				'no unresolved drill-in pointer when chain is fully inlined',
			);
		});

		test('buddy_workflow_diagnose nested drill sections show the full sub-execution task log, not just the failing task', async () => {
			// root → failed child (with a preceding succeeded sibling task) → failed grandchild
			// (with a preceding succeeded sibling task). Default depth=3 should inline both nested levels.
			const taskLogsByExec: Record<string, unknown[]> = {
				'exec-1': [
					{
						originalWorkflowTaskName: 'root_task',
						status: 'failed',
						message: 'root boom',
						input: {},
						result: {},
						taskExecutionId: 'te-root',
					},
				],
				'exec-child': [
					{
						originalWorkflowTaskName: 'child_setup',
						status: 'succeeded',
						taskExecutionId: 'te-child-setup',
					},
					{
						originalWorkflowTaskName: 'child_task',
						status: 'failed',
						message: 'child boom',
						input: {},
						result: {},
						taskExecutionId: 'te-child',
					},
				],
				'exec-grand': [
					{
						originalWorkflowTaskName: 'grand_setup',
						status: 'succeeded',
						taskExecutionId: 'te-grand-setup',
					},
					{
						originalWorkflowTaskName: 'grand_task',
						status: 'failed',
						message: 'grand boom',
						input: {},
						result: {},
						taskExecutionId: 'te-grand',
					},
				],
			};
			const childrenByExec: Record<string, unknown[]> = {
				'exec-1': [
					{
						id: 'exec-child',
						status: 'failed',
						parentTaskExecutionId: 'te-root',
						workflow: { id: 'wf-child', name: 'Child WF' },
					},
				],
				'exec-child': [
					{
						id: 'exec-grand',
						status: 'failed',
						parentTaskExecutionId: 'te-child',
						workflow: { id: 'wf-grand', name: 'Grand WF' },
					},
				],
				'exec-grand': [],
			};
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						const where = (variables?.where ?? {}) as { workflowExecutionId?: string };
						return { data: { taskLogs: taskLogsByExec[where.workflowExecutionId ?? ''] ?? [] } };
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						return {
							data: {
								workflowExecution: {
									id: where.id,
									status: 'FAILED',
									orgId: 'org-1',
									workflow: { id: 'wf-1', name: 'Root WF', orgId: 'org-1' },
									childExecutions: childrenByExec[where.id ?? ''] ?? [],
								},
							},
						};
					}
					if (query.includes('RewstBuddyExecutionContexts'))
						return { data: { workflowExecutionContexts: [{}] } };
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /Nested diagnosis \(level 1/, 'level 1 nested section present');
			assert.match(
				output,
				/child_setup: succeeded/,
				'level 1 section includes the sibling task, not just child_task',
			);
			assert.match(output, /Nested diagnosis \(level 2/, 'level 2 nested section present');
			assert.match(
				output,
				/grand_setup: succeeded/,
				'level 2 section includes the sibling task, not just grand_task',
			);
		});

		test('buddy_workflow_diagnose depth 1 preserves old single-level behavior', async () => {
			const { deps } = makeDiagnoseDeps({
				taskLogs: [
					{
						originalWorkflowTaskName: 'the_failer',
						status: 'failed',
						message: 'boom',
						input: {},
						result: {},
						taskExecutionId: 'te-1',
					},
				],
				childExecutions: [
					{
						id: 'exec-child',
						status: 'failed',
						parentTaskExecutionId: 'te-1',
						workflow: { id: 'wf-sub', name: 'Sub Flow' },
					},
				],
				childExecutionsOrgId: 'org-1',
			});
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1', depth: 1 } },
				deps,
			);
			assert.match(output, /Likely deeper cause.*exec-child/, 'drill-in pointer present at depth 1');
			assert.ok(!output.includes('Nested diagnosis'), 'no nested diagnosis section at depth 1');
		});

		test('buddy_workflow_diagnose drill error degrades to a note', async () => {
			const deps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					if (query.includes('RewstBuddyTaskLogs')) {
						const where = (variables?.where ?? {}) as { workflowExecutionId?: string };
						if (where.workflowExecutionId === 'exec-child') throw new Error('child logs unavailable');
						return {
							data: {
								taskLogs: [
									{
										originalWorkflowTaskName: 'root_task',
										status: 'failed',
										message: 'root boom',
										input: {},
										result: {},
										taskExecutionId: 'te-root',
									},
								],
							},
						};
					}
					if (query.includes('RewstBuddyChildExecutions')) {
						const where = (variables?.where ?? {}) as { id?: string };
						return {
							data: {
								workflowExecution: {
									id: where.id,
									status: 'FAILED',
									orgId: 'org-1',
									workflow: { id: 'wf-1', name: 'Root WF', orgId: 'org-1' },
									childExecutions:
										where.id === 'exec-1'
											? [
													{
														id: 'exec-child',
														status: 'failed',
														parentTaskExecutionId: 'te-root',
														workflow: { id: 'wf-sub', name: 'Sub Flow' },
													},
												]
											: [],
								},
							},
						};
					}
					if (query.includes('RewstBuddyExecutionContexts'))
						return { data: { workflowExecutionContexts: [{}] } };
					return { data: {} };
				},
			};
			const output = await runWorkflowTool(
				{ tool: WORKFLOW_DIAGNOSE_TOOL_NAME, args: { executionId: 'exec-1' } },
				deps,
			);
			assert.match(output, /root_task: failed/, 'root digest still returned');
			assert.match(output, /Nested diagnosis stopped:.*child logs unavailable/, 'error degrades to a note');
		});
	});
});
