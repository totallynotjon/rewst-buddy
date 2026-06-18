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

	test('no tools yields header, native-tool policy, and footer', () => {
		const directive = buildEngineeringDirective(new Set());
		assert.ok(directive.includes('# Rewst Buddy VS Code Context'));
		assert.ok(!directive.includes('<engineering_layer_directive>'));
		assert.ok(!/supersedes/i.test(directive));
		assert.ok(!directive.includes('# Tool-call discipline'));
		assert.ok(!directive.includes('# Tool selection'));
		// The native-tool curb ships even with no editor tools.
		assert.ok(directive.includes('# Native internal tools: off by default'));
	});

	test('always steers complex work into todos and agent delegation', () => {
		// The Working method section ships unconditionally, so the decomposition /
		// todo / agent steering is present regardless of the editor tool surface.
		for (const tools of [new Set<string>(), new Set(['read_file']), new Set(['buddy_graphql_read', 'web_search'])]) {
			const directive = buildEngineeringDirective(tools);
			assert.ok(/decompose by default/i.test(directive), 'tells the model to decompose');
			assert.ok(/list of todos/i.test(directive), 'frames the plan as a todo list');
			assert.ok(/todo-list tool/i.test(directive), 'prefers a todo-list tool when present');
			assert.ok(/agent/i.test(directive), 'tells the model to delegate to agents');
			assert.ok(/on your own initiative/i.test(directive), 'no need to be asked to use todos/agents');
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

	test('always curbs reflexive documentation search and Jinja rendering', () => {
		for (const tools of [new Set<string>(), new Set(['read_file']), new Set(['buddy_graphql_read', 'web_search'])]) {
			const directive = buildEngineeringDirective(tools);
			assert.ok(directive.includes('# Native internal tools: off by default'), 'native-tool policy present');
			assert.ok(/documentation .*search/i.test(directive), 'names documentation search');
			assert.ok(directive.includes('gitbook_retriever'), 'names the gitbook tool exactly');
			assert.ok(/FIRST action in a new chat is NEVER/i.test(directive), 'forbids opening with a doc search');
			assert.ok(/warm-up or throwaway/i.test(directive), 'forbids a speculative warm-up call');
			assert.ok(directive.includes('listWorkflow'), 'names the native wrapper to suppress');
			assert.ok(/Jinja render/i.test(directive), 'names Jinja render/test');
		}
	});

	test('built-in-only tools still get the discipline rules, without the GraphQL activation rule', () => {
		const directive = buildEngineeringDirective(new Set(['read_file', 'list_template_links']));
		assert.ok(directive.includes('# Tool-call discipline'));
		assert.ok(directive.includes('NEVER write placeholder text'));
		assert.ok(!directive.includes('# Tool selection'), 'no priority bullets without graphql/web tools');
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

	test('graphql tools add the safe-read priority bullet without activation wording', () => {
		const directive = buildEngineeringDirective(
			new Set(['buddy_graphql_read', 'buddy_graphql_mutate', 'buddy_graphql_schema']),
		);
		assert.ok(directive.includes('# Tool selection'));
		assert.ok(directive.includes('GraphQL reads, before native wrappers'));
		assert.ok(directive.includes('buddy_graphql_read'));
		assert.ok(directive.includes('buddy_graphql_mutate'));
		assert.ok(/last resort/i.test(directive));
		assert.ok(directive.includes('# Tool-call discipline'));
		assert.ok(!directive.includes('activate_rewst_graphql_tools'));
	});

	test('workflow tools add a priority bullet ranked above GraphQL', () => {
		const directive = buildEngineeringDirective(
			new Set(['buddy_workflow_get', 'buddy_workflow_edit', 'buddy_graphql_read', 'buddy_graphql_schema']),
		);
		assert.ok(directive.includes('# Tool selection'));
		const workflowIdx = directive.indexOf('purpose-built workflow tools');
		const graphqlIdx = directive.indexOf('GraphQL reads, before native wrappers');
		assert.ok(workflowIdx >= 0, 'workflow bullet present');
		assert.ok(graphqlIdx >= 0, 'graphql bullet present');
		assert.ok(workflowIdx < graphqlIdx, 'workflow tools are ranked before GraphQL');
		assert.ok(directive.includes('buddy_execution_logs'), 'names the execution-logs tool');
		assert.ok(directive.includes('buddy_workflow_get'), 'names the workflow read tool');
	});

	test('workflow tools alone (no graphql) still emit the priority section', () => {
		const directive = buildEngineeringDirective(new Set(['buddy_workflow_get', 'buddy_workflow_edit']));
		assert.ok(directive.includes('# Tool selection'));
		assert.ok(directive.includes('purpose-built workflow tools'));
		assert.ok(!directive.includes('activate_rewst_graphql_tools'), 'graphql rule withheld without graphql tools');
	});

	test('web tools add their priority bullet', () => {
		const directive = buildEngineeringDirective(new Set(['web_search']));
		assert.ok(directive.includes('# Tool selection'));
		assert.ok(directive.includes('web_search'));
		assert.ok(!directive.includes('activate_rewst_graphql_tools'));
	});

	test('web bullet steers current events to web_search and forbids a cannot-browse refusal', () => {
		const directive = buildEngineeringDirective(new Set(['web_search']));
		assert.ok(/current events/i.test(directive), 'names current events');
		assert.ok(/news/i.test(directive), 'names news');
		assert.ok(/knowledge cutoff/i.test(directive), 'forbids a knowledge-cutoff excuse');
		assert.ok(/cannot browse|can ?not browse/i.test(directive), 'forbids a cannot-browse refusal');
	});
});

suite('Unit: buildNativeToolReminder', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('always curbs reflexive doc search and a throwaway native call', () => {
		for (const tools of [new Set<string>(), new Set(['read_file']), new Set(['web_search'])]) {
			const reminder = buildNativeToolReminder(tools);
			assert.ok(reminder.includes('gitbook_retriever'), 'names the gitbook tool');
			assert.ok(reminder.includes('listWorkflow'), 'names the throwaway native call to suppress');
		}
	});

	test('calls out editor edit tools as vscode-tool only when present', () => {
		const reminder = buildNativeToolReminder(new Set(['insert_edit_into_file']));
		assert.ok(reminder.includes('insert_edit_into_file'), 'names the insert edit tool');
		assert.ok(/vscode-tool block/i.test(reminder), 'requires the vscode-tool protocol');
		assert.ok(/native\/Rewst function/i.test(reminder), 'forbids native/Rewst invocation path');
	});

	test('repeats Rewst tool priority in the highest-recency reminder', () => {
		const reminder = buildNativeToolReminder(
			new Set(['buddy_workflow_search', 'buddy_workflow_get', 'buddy_graphql_schema', 'buddy_graphql_read']),
		);
		assert.ok(/workflow listing, reading, editing, running, or debugging/i.test(reminder));
		assert.ok(/buddy_workflow_\*/i.test(reminder));
		assert.ok(/other live Rewst data/i.test(reminder));
		assert.ok(reminder.includes('buddy_graphql_schema'));
		assert.ok(reminder.includes('buddy_graphql_read'));
		assert.ok(/before native platform wrappers/i.test(reminder));
	});

	test('does not push memory-only answers for non-Rewst questions', () => {
		const reminder = buildNativeToolReminder(new Set());
		// The old wording said "answer directly", which steered the model into
		// refusing live-info questions from memory; it now allows reaching for a tool.
		assert.ok(/answer it directly or with the right tool/i.test(reminder));
	});

	test('adds the web carve-out only when web_search is available', () => {
		const withWeb = buildNativeToolReminder(new Set(['web_search']));
		assert.ok(/web_search/.test(withWeb), 'names web_search when available');
		assert.ok(/knowledge cutoff/i.test(withWeb), 'forbids a knowledge-cutoff excuse');

		const withoutWeb = buildNativeToolReminder(new Set(['read_file']));
		assert.ok(!withoutWeb.includes('web_search'), 'never advertises a tool the chat cannot run');
	});
});
