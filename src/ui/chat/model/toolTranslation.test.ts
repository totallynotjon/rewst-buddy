import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import {
	buildInstructionsForChatTools,
	collectToolCalls,
	extractTrailingToolResults,
	filterToolsBySettings,
	formatToolResultsMessage,
	rejectedToolsNote,
	translateToolRequests,
} from './toolTranslation';
import type { AiToolSettings } from './lmTools';

const { suite, test } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

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

function chatTool(name: string, description = `${name} tool`): vscode.LanguageModelChatTool {
	return { name, description, inputSchema: { type: 'object' } };
}

function fence(request: object): string {
	return '```rewst-tool\n' + JSON.stringify(request) + '\n```';
}

suite('Unit: toolTranslation', () => {
	suite('filterToolsBySettings()', () => {
		test('withholds a rewst tool whose setting is disabled, even when VS Code passes it', () => {
			const tools = [chatTool('read_file'), chatTool('web_search')];
			const filtered = filterToolsBySettings(tools, settings({ enableWebTools: true }));
			assert.deepStrictEqual(
				filtered.map(tool => tool.name),
				['web_search'],
			);
		});

		test('passes non-rewst tools through untouched', () => {
			const filtered = filterToolsBySettings([chatTool('other_ext_tool')], settings());
			assert.strictEqual(filtered.length, 1);
		});

		test('handles missing options.tools', () => {
			assert.deepStrictEqual(filterToolsBySettings(undefined, settings()), []);
		});
	});

	suite('buildInstructionsForChatTools()', () => {
		test('advertises known tools with their protocol arg signatures', () => {
			const instructions = buildInstructionsForChatTools([chatTool('read_file')]);
			assert.ok(instructions.includes('read_file'));
			assert.ok(instructions.includes('"path": string'), 'known tools keep their curated signature');
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
		test('collects calls from history and formats trailing results', () => {
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

			const calls = collectToolCalls(messages);
			const formatted = formatToolResultsMessage(trailing, calls);
			assert.ok(formatted.includes('### read_file'));
			assert.ok(formatted.includes('file contents here'));
			assert.ok(formatted.includes('Tool results:'));
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
