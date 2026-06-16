import * as assert from 'assert';
import * as Mocha from 'mocha';
import { buildEngineeringDirective, buildNativeToolReminder } from './engineeringDirective';

const { suite, test } = Mocha;

suite('Unit: engineeringDirective', () => {
	test('no tools yields header, native-tool policy, and footer', () => {
		const directive = buildEngineeringDirective(new Set());
		assert.ok(directive.includes('<engineering_layer_directive>'));
		assert.ok(!directive.includes('# Tool-call discipline'));
		assert.ok(!directive.includes('# Tool selection'));
		// The native-tool curb ships even with no editor tools.
		assert.ok(directive.includes('# Native internal tools: off by default'));
	});

	test('always steers complex work into todos and agent delegation', () => {
		// The Working method section ships unconditionally, so the decomposition /
		// todo / agent steering is present regardless of the editor tool surface.
		for (const tools of [new Set<string>(), new Set(['read_file']), new Set(['rewst_graphql', 'web_search'])]) {
			const directive = buildEngineeringDirective(tools);
			assert.ok(/decompose by default/i.test(directive), 'tells the model to decompose');
			assert.ok(/list of todos/i.test(directive), 'frames the plan as a todo list');
			assert.ok(/todo-list tool/i.test(directive), 'prefers a todo-list tool when present');
			assert.ok(/agent/i.test(directive), 'tells the model to delegate to agents');
			assert.ok(/on your own initiative/i.test(directive), 'no need to be asked to use todos/agents');
		}
	});

	test('always curbs reflexive documentation search and Jinja rendering', () => {
		for (const tools of [new Set<string>(), new Set(['read_file']), new Set(['rewst_graphql', 'web_search'])]) {
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

	test('graphql tools add the priority bullet and the activation rule', () => {
		const directive = buildEngineeringDirective(new Set(['rewst_graphql', 'rewst_graphql_schema']));
		assert.ok(directive.includes('# Tool selection'));
		assert.ok(directive.includes('Live Rewst data → GraphQL first'));
		assert.ok(directive.includes('# Tool-call discipline'));
		assert.ok(directive.includes('activate_rewst_graphql_tools'));
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
	test('always curbs reflexive doc search and a throwaway native call', () => {
		for (const tools of [new Set<string>(), new Set(['read_file']), new Set(['web_search'])]) {
			const reminder = buildNativeToolReminder(tools);
			assert.ok(reminder.includes('gitbook_retriever'), 'names the gitbook tool');
			assert.ok(reminder.includes('listWorkflow'), 'names the throwaway native call to suppress');
		}
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
