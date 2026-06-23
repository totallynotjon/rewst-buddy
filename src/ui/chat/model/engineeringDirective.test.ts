import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { SessionManager } from '@sessions';
import { buildEngineeringDirective, buildNativeToolReminder } from './engineeringDirective';

const { suite, test, setup } = Mocha;

suite('Unit: engineeringDirective', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('no tools yields the generic header and engineering frame', () => {
		const directive = buildEngineeringDirective(new Set());
		assert.ok(directive.includes('# Rewst Buddy VS Code Context'));
		assert.ok(!directive.includes('<engineering_layer_directive>'));
		assert.ok(!/supersedes/i.test(directive));
		assert.ok(!directive.includes('# Tool protocol guidance'));
		assert.ok(!directive.includes('# Tool selection'));
		assert.ok(!directive.includes('# Native internal tools: off by default'));
		assert.ok(!directive.includes('# Rewst conventions that carry forward'));
	});

	test('always steers complex work into todos and agent delegation', () => {
		// The Working method section ships unconditionally, so the decomposition /
		// todo / agent steering is present regardless of the editor tool surface.
		for (const tools of [new Set<string>(), new Set(['read_file']), new Set(['buddy_graphql'])]) {
			const directive = buildEngineeringDirective(tools);
			assert.ok(/decompose by default/i.test(directive), 'tells the model to decompose');
			assert.ok(/list of todos/i.test(directive), 'frames the plan as a todo list');
			assert.ok(/todo-list tool/i.test(directive), 'prefers a todo-list tool when present');
			assert.ok(/agent/i.test(directive), 'tells the model to delegate to agents');
			assert.ok(/on your own initiative/i.test(directive), 'no need to be asked to use todos/agents');
			// Todos must be marked off as progress happens, not batched at the end.
			assert.ok(/keep its status current/i.test(directive), 'keeps the todo status current as work lands');
			assert.ok(
				/flip that item to completed the moment it is done/i.test(directive),
				'marks each todo complete the moment it finishes',
			);
			assert.ok(
				/never batch the updates to the end/i.test(directive),
				'forbids batching todo status updates to the end',
			);
			// The list must be driven to the end and reconciled before declaring done,
			// so the model cannot believe it finished while todos remain unchecked.
			assert.ok(/drive the list all the way to the end/i.test(directive), 'drives the todo list to completion');
			assert.ok(
				/reconcile against the recorded list rather than your own memory/i.test(directive),
				'reconciles against recorded todo state, not memory of what it did',
			);
			assert.ok(
				/never report work as done while its todo is unchecked or while steps remain/i.test(directive),
				'forbids declaring done while todos remain unchecked',
			);
			// The todo/agent tools collide with native tool names; the steering must
			// keep them on the vscode-tool protocol, not native function calls.
			assert.ok(
				/never as a native function call/i.test(directive),
				'keeps todo/agent tools on the vscode-tool protocol, not native calls',
			);
			// Research must be planned and targeted, tracked as todos like other work.
			assert.ok(/research is planned/i.test(directive), 'steers research to be planned');
			assert.ok(/targeted, never open-ended/i.test(directive), 'steers research to be targeted');
		}
	});

	test('does not include Rewst-specific native-tool steering', () => {
		for (const tools of [new Set<string>(), new Set(['read_file']), new Set(['buddy_graphql'])]) {
			const directive = buildEngineeringDirective(tools);
			assert.ok(!directive.includes('gitbook_retriever'), 'does not steer Rewst docs search');
			assert.ok(!directive.includes('listWorkflow'), 'does not steer native Rewst wrappers');
			assert.ok(!/Jinja render/i.test(directive), 'does not steer Rewst Jinja rendering');
		}
	});

	test('built-in-only tools still get the discipline rules, without the GraphQL activation rule', () => {
		const directive = buildEngineeringDirective(new Set(['read_file', 'create_file']));
		assert.ok(directive.includes('# Tool protocol guidance'));
		assert.ok(directive.includes('NEVER write placeholder text'));
		assert.ok(!directive.includes('# Tool selection'), 'no priority bullets without graphql/workflow tools');
		assert.ok(!directive.includes('activate_rewst_graphql_tools'), 'graphql rule withheld');
	});

	test('edit tools are explicitly steered away from native Rewst tool calls', () => {
		const directive = buildEngineeringDirective(
			new Set(['insert_edit_into_file', 'replace_string_in_file', 'create_file', 'run_in_terminal']),
		);
		assert.ok(directive.includes('insert_edit_into_file'), 'names the insert edit tool');
		assert.ok(directive.includes('replace_string_in_file'), 'names the replace edit tool');
		assert.ok(directive.includes('create_file'), 'names the create file tool');
		assert.ok(/native\/Rewst function/i.test(directive), 'forbids native/Rewst invocation path');
		assert.ok(/vscode-tool block/i.test(directive), 'requires the vscode-tool protocol');
	});

	test('Rewst tool names do not add priority bullets or activation rules', () => {
		const directive = buildEngineeringDirective(new Set(['buddy_graphql', 'buddy_graphql_schema']));
		assert.ok(!directive.includes('# Tool selection'));
		assert.ok(!directive.includes('GraphQL, before native wrappers'));
		assert.ok(directive.includes('# Tool protocol guidance'));
		assert.ok(!directive.includes('activate_rewst_graphql_tools'));
	});

	test('workflow tool names are not advertised with Rewst-specific notes', () => {
		const directive = buildEngineeringDirective(
			new Set(['buddy_workflow_get', 'buddy_workflow_edit', 'buddy_graphql', 'buddy_graphql_schema']),
		);
		assert.ok(!directive.includes('# Tool selection'));
		assert.ok(!directive.includes('purpose-built workflow tools'));
		assert.ok(!directive.includes('buddy_execution_logs'));
	});
});

suite('Unit: buildNativeToolReminder', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('does not mention Rewst-specific native tools', () => {
		for (const tools of [new Set<string>(), new Set(['read_file'])]) {
			const reminder = buildNativeToolReminder(tools);
			assert.ok(!reminder.includes('gitbook_retriever'), 'does not mention Rewst docs search');
			assert.ok(!reminder.includes('listWorkflow'), 'does not mention native Rewst wrappers');
		}
	});

	test('calls out editor edit tools as vscode-tool only when present', () => {
		const reminder = buildNativeToolReminder(new Set(['insert_edit_into_file']));
		assert.ok(reminder.includes('insert_edit_into_file'), 'names the insert edit tool');
		assert.ok(/vscode-tool block/i.test(reminder), 'requires the vscode-tool protocol');
		assert.ok(/native\/Rewst function/i.test(reminder), 'forbids native/Rewst invocation path');
	});

	test('does not push memory-only answers for non-Rewst questions', () => {
		const reminder = buildNativeToolReminder(new Set());
		assert.strictEqual(reminder, '');
	});
});
