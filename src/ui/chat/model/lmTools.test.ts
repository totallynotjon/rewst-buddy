import * as assert from 'assert';
import * as Mocha from 'mocha';
import { ALL_TOOL_SPECS, enabledToolNames, isToolPermitted, type AiToolSettings } from './lmTools';

const { suite, test } = Mocha;

function settings(overrides: Partial<AiToolSettings> = {}): AiToolSettings {
	return {
		enableWorkspaceTools: false,
		enableEditTools: false,
		enableWebTools: false,
		enableCommandTool: false,
		enableGraphqlTool: false,
		...overrides,
	};
}

suite('Unit: lmTools', () => {
	test('exposes all 16 protocol tools with input schemas', () => {
		assert.strictEqual(ALL_TOOL_SPECS.length, 16);
		for (const spec of ALL_TOOL_SPECS) {
			assert.ok(spec.inputSchema, `${spec.name} carries an inputSchema`);
		}
	});

	suite('enabledToolNames()', () => {
		test('everything disabled yields no tools', () => {
			assert.strictEqual(enabledToolNames(settings()).size, 0);
		});

		test('workspace tools without edit tools excludes edit_file/write_file', () => {
			const names = enabledToolNames(settings({ enableWorkspaceTools: true }));
			assert.ok(names.has('read_file'));
			assert.ok(names.has('list_template_links'));
			assert.ok(!names.has('edit_file'));
			assert.ok(!names.has('write_file'));
		});

		test('edit tools require workspace tools too', () => {
			const editOnly = enabledToolNames(settings({ enableEditTools: true }));
			assert.ok(!editOnly.has('edit_file'));
			const both = enabledToolNames(settings({ enableWorkspaceTools: true, enableEditTools: true }));
			assert.ok(both.has('edit_file'));
			assert.ok(both.has('write_file'));
		});

		test('each opt-in setting yields exactly its tools', () => {
			assert.deepStrictEqual([...enabledToolNames(settings({ enableWebTools: true }))].sort(), [
				'fetch_url',
				'web_search',
			]);
			assert.deepStrictEqual([...enabledToolNames(settings({ enableCommandTool: true }))], ['run_command']);
			assert.deepStrictEqual([...enabledToolNames(settings({ enableGraphqlTool: true }))].sort(), [
				'rewst_graphql',
				'rewst_graphql_schema',
			]);
		});

		test('everything enabled yields all 16', () => {
			const names = enabledToolNames(
				settings({
					enableWorkspaceTools: true,
					enableEditTools: true,
					enableWebTools: true,
					enableCommandTool: true,
					enableGraphqlTool: true,
				}),
			);
			assert.strictEqual(names.size, 16);
		});
	});

	suite('isToolPermitted()', () => {
		test('governed tools follow their setting', () => {
			assert.strictEqual(isToolPermitted('read_file', settings()), false);
			assert.strictEqual(isToolPermitted('read_file', settings({ enableWorkspaceTools: true })), true);
			assert.strictEqual(isToolPermitted('rewst_graphql', settings()), false);
		});

		test('names outside the rewst set are not governed', () => {
			assert.strictEqual(isToolPermitted('some_other_extension_tool', settings()), true);
		});
	});
});
