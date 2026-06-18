import * as assert from 'assert';
import * as Mocha from 'mocha';
import { ALL_TOOL_SPECS, enabledToolNames, isToolPermitted, type AiToolSettings } from './lmTools';

const { suite, test } = Mocha;

function settings(overrides: Partial<AiToolSettings> = {}): AiToolSettings {
	return {
		enableWorkspaceTools: false,
		enableWebTools: false,
		enableGraphqlUnsafeTool: false,
		enableWorkflowTools: false,
		...overrides,
	};
}

suite('Unit: lmTools', () => {
	test('exposes all 15 protocol tools with input schemas', () => {
		assert.strictEqual(ALL_TOOL_SPECS.length, 15);
		for (const spec of ALL_TOOL_SPECS) {
			assert.ok(spec.inputSchema, `${spec.name} carries an inputSchema`);
		}
	});

	suite('enabledToolNames()', () => {
		test('everything disabled still yields safe GraphQL tools and the cached-result reader', () => {
			assert.deepStrictEqual([...enabledToolNames(settings())].sort(), [
				'buddy_graphql_read',
				'buddy_graphql_schema',
				'buddy_result_read',
			]);
		});

		test('each opt-in setting yields its tools plus the cached-result reader', () => {
			// buddy_result_read rides along with any enabled capability, since any of
			// them can produce the oversized output it reads back.
			assert.deepStrictEqual([...enabledToolNames(settings({ enableWorkspaceTools: true }))].sort(), [
				'buddy_graphql_read',
				'buddy_graphql_schema',
				'buddy_result_read',
				'list_template_links',
			]);
			assert.deepStrictEqual([...enabledToolNames(settings({ enableWebTools: true }))].sort(), [
				'buddy_graphql_read',
				'buddy_graphql_schema',
				'buddy_result_read',
				'web_search',
			]);
			assert.deepStrictEqual([...enabledToolNames(settings({ enableGraphqlUnsafeTool: true }))].sort(), [
				'buddy_graphql_mutate',
				'buddy_graphql_read',
				'buddy_graphql_schema',
				'buddy_result_read',
			]);
			assert.deepStrictEqual([...enabledToolNames(settings({ enableWorkflowTools: true }))].sort(), [
				'buddy_action_search',
				'buddy_execution_logs',
				'buddy_graphql_read',
				'buddy_graphql_schema',
				'buddy_render_jinja',
				'buddy_result_read',
				'buddy_workflow_autolayout',
				'buddy_workflow_edit',
				'buddy_workflow_executions',
				'buddy_workflow_get',
				'buddy_workflow_run',
				'buddy_workflow_search',
			]);
		});

		test('everything enabled yields all 15', () => {
			const names = enabledToolNames(
				settings({
					enableWorkspaceTools: true,
					enableWebTools: true,
					enableGraphqlUnsafeTool: true,
					enableWorkflowTools: true,
				}),
			);
			assert.strictEqual(names.size, 15);
		});
	});

	suite('isToolPermitted()', () => {
		test('governed tools follow their setting', () => {
			assert.strictEqual(isToolPermitted('list_template_links', settings()), false);
			assert.strictEqual(isToolPermitted('list_template_links', settings({ enableWorkspaceTools: true })), true);
			assert.strictEqual(isToolPermitted('buddy_graphql_schema', settings()), true);
			assert.strictEqual(isToolPermitted('buddy_graphql_read', settings()), true);
			assert.strictEqual(isToolPermitted('buddy_graphql_mutate', settings()), false);
			assert.strictEqual(
				isToolPermitted('buddy_graphql_mutate', settings({ enableGraphqlUnsafeTool: true })),
				true,
			);
		});

		test('names outside the rewst set are not governed', () => {
			assert.strictEqual(isToolPermitted('some_other_extension_tool', settings()), true);
			assert.strictEqual(isToolPermitted('read_file', settings()), true);
		});
	});
});
