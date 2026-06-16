import * as assert from 'assert';
import * as Mocha from 'mocha';
import { buildEngineeringDirective } from './engineeringDirective';

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
});
