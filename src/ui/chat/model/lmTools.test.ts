import * as assert from 'assert';
import * as Mocha from 'mocha';
import { ALL_TOOL_SPECS, enabledToolNames, isToolPermitted, type AiToolSettings } from './lmTools';

const { suite, test } = Mocha;

function settings(overrides: Partial<AiToolSettings> = {}): AiToolSettings {
	return {
		enableWorkspaceTools: false,
		enableWebTools: false,
		enableGraphqlTool: false,
		...overrides,
	};
}

suite('Unit: lmTools', () => {
	test('exposes all 4 protocol tools with input schemas', () => {
		assert.strictEqual(ALL_TOOL_SPECS.length, 4);
		for (const spec of ALL_TOOL_SPECS) {
			assert.ok(spec.inputSchema, `${spec.name} carries an inputSchema`);
		}
	});

	suite('enabledToolNames()', () => {
		test('everything disabled yields no tools', () => {
			assert.strictEqual(enabledToolNames(settings()).size, 0);
		});

		test('each opt-in setting yields exactly its tools', () => {
			assert.deepStrictEqual(
				[...enabledToolNames(settings({ enableWorkspaceTools: true }))],
				['list_template_links'],
			);
			assert.deepStrictEqual([...enabledToolNames(settings({ enableWebTools: true }))].sort(), ['web_search']);
			assert.deepStrictEqual([...enabledToolNames(settings({ enableGraphqlTool: true }))].sort(), [
				'rewst_graphql',
				'rewst_graphql_schema',
			]);
		});

		test('everything enabled yields all 4', () => {
			const names = enabledToolNames(
				settings({
					enableWorkspaceTools: true,
					enableWebTools: true,
					enableGraphqlTool: true,
				}),
			);
			assert.strictEqual(names.size, 4);
		});
	});

	suite('isToolPermitted()', () => {
		test('governed tools follow their setting', () => {
			assert.strictEqual(isToolPermitted('list_template_links', settings()), false);
			assert.strictEqual(isToolPermitted('list_template_links', settings({ enableWorkspaceTools: true })), true);
			assert.strictEqual(isToolPermitted('rewst_graphql', settings()), false);
		});

		test('names outside the rewst set are not governed', () => {
			assert.strictEqual(isToolPermitted('some_other_extension_tool', settings()), true);
			assert.strictEqual(isToolPermitted('read_file', settings()), true);
		});
	});
});
