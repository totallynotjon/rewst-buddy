import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import {
	buildInstructionsForChatTools,
	collectToolCalls,
	extractTrailingToolResults,
	filterToolsBySettings,
	rejectedToolsNote,
	translateToolRequests,
} from './toolTranslation';
import type { AiToolSettings } from './lmTools';

const { suite, test } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

function settings(overrides: Partial<AiToolSettings> = {}): AiToolSettings {
	return {
		enableWorkspaceTools: false,
		enableGraphqlTool: false,
		enableWorkflowTools: false,
		...overrides,
	};
}

function chatTool(name: string, description = `${name} tool`): vscode.LanguageModelChatTool {
	return { name, description, inputSchema: { type: 'object' } };
}

function fence(request: object): string {
	return '```vscode-tool\n' + JSON.stringify(request) + '\n```';
}

suite('Unit: toolTranslation', () => {
	suite('filterToolsBySettings()', () => {
		test('withholds a rewst tool whose setting is disabled, even when VS Code passes it', () => {
			const tools = [chatTool('list_template_links'), chatTool('buddy_graphql_schema')];
			const filtered = filterToolsBySettings(tools, settings({ enableGraphqlTool: true }));
			assert.deepStrictEqual(
				filtered.map(tool => tool.name),
				['buddy_graphql_schema'],
			);
		});

		test("passes non-rewst tools through untouched (e.g. the chat's built-in file tools)", () => {
			const filtered = filterToolsBySettings([chatTool('other_ext_tool'), chatTool('read_file')], settings());
			assert.strictEqual(filtered.length, 2);
		});

		test('handles missing options.tools', () => {
			assert.deepStrictEqual(filterToolsBySettings(undefined, settings()), []);
		});
	});

	suite('buildInstructionsForChatTools()', () => {
		test('advertises known tools with their curated descriptions', () => {
			const instructions = buildInstructionsForChatTools([chatTool('list_template_links')]);
			assert.ok(instructions.includes('list_template_links'));
			assert.ok(
				instructions.includes('List local files linked to Rewst templates'),
				'known tools keep their curated description',
			);
		});

		test('advertises unknown tools with their schema', () => {
			const instructions = buildInstructionsForChatTools([chatTool('other_tool', 'does things')]);
			assert.ok(instructions.includes('other_tool'));
			assert.ok(instructions.includes('does things'));
		});
	});

	suite('translateToolRequests()', () => {
		test('emits tool-call parts for permitted requests', () => {
			const content = `Checking.\n${fence({ tool: 'read_file', args: { path: 'a.txt' } })}`;
			const { calls, rejectedNames } = translateToolRequests(content, new Set(['read_file']));
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0].name, 'read_file');
			assert.deepStrictEqual(calls[0].input, { path: 'a.txt' });
			assert.ok(calls[0].callId.length > 0);
			assert.deepStrictEqual(rejectedNames, []);
		});

		test('never emits a call outside the permitted set', () => {
			const content = fence({ tool: 'run_command', args: { command: 'rm -rf /' } });
			const { calls, rejectedNames } = translateToolRequests(content, new Set(['read_file']));
			assert.strictEqual(calls.length, 0);
			assert.deepStrictEqual(rejectedNames, ['run_command']);
		});

		test('generates unique call ids', () => {
			const content = `${fence({ tool: 'read_file', args: { path: 'a' } })}\n${fence({ tool: 'read_file', args: { path: 'b' } })}`;
			const { calls } = translateToolRequests(content, new Set(['read_file']));
			assert.strictEqual(calls.length, 2);
			assert.notStrictEqual(calls[0].callId, calls[1].callId);
		});
	});

	suite('tool result round-trip', () => {
		test('collects calls from history and extracts trailing results', () => {
			const call = new vscode.LanguageModelToolCallPart('call-7', 'read_file', { path: 'a.txt' });
			const result = new vscode.LanguageModelToolResultPart('call-7', [
				new vscode.LanguageModelTextPart('file contents here'),
			]);
			const messages = [
				{ role: User, content: [new vscode.LanguageModelTextPart('check a.txt')] },
				{ role: Assistant, content: [call] },
				{ role: User, content: [result] },
			];

			const trailing = extractTrailingToolResults(messages);
			assert.ok(trailing);
			assert.strictEqual(trailing.length, 1);
			assert.strictEqual(trailing[0].callId, 'call-7');

			const calls = collectToolCalls(messages);
			assert.strictEqual(calls.get('call-7')?.name, 'read_file');
		});

		test('ordinary user turns are not tool results', () => {
			const messages = [{ role: User, content: [new vscode.LanguageModelTextPart('plain question')] }];
			assert.strictEqual(extractTrailingToolResults(messages), undefined);
		});
	});

	test('rejectedToolsNote names the tools once each', () => {
		const note = rejectedToolsNote(['run_command', 'run_command']);
		assert.ok(note.includes('`run_command`'));
		assert.strictEqual(note.match(/run_command/g)?.length, 1);
	});
});
