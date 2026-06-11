import * as assert from 'assert';
import * as Mocha from 'mocha';
import { buildEngineeringDirective } from './engineeringDirective';

const { suite, test } = Mocha;

suite('Unit: engineeringDirective', () => {
	test('no tools yields header and footer only', () => {
		const directive = buildEngineeringDirective(new Set());
		assert.ok(directive.includes('<engineering_layer_directive>'));
		assert.ok(!directive.includes('# Tool-call discipline'));
		assert.ok(!directive.includes('# Tool selection'));
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
		const directive = buildEngineeringDirective(new Set(['web_search', 'fetch_url']));
		assert.ok(directive.includes('# Tool selection'));
		assert.ok(directive.includes('web_search'));
		assert.ok(!directive.includes('activate_rewst_graphql_tools'));
	});
});
