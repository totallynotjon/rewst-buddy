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
		enableWebTools: false,
		enableGraphqlTool: false,
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
			const tools = [chatTool('list_template_links'), chatTool('web_search')];
			const filtered = filterToolsBySettings(tools, settings({ enableWebTools: true }));
			assert.deepStrictEqual(
				filtered.map(tool => tool.name),
				['web_search'],
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

		test('emits a call for a request whose args carry a ``` code block (#16)', () => {
			const request = { tool: 'update_template_body', args: { body: '```jinja\n{{ x }}\n```' } };
			const content = `Saving.\n${fence(request)}`;
			const { calls } = translateToolRequests(content, new Set(['update_template_body']));
			assert.strictEqual(calls.length, 1);
			assert.deepStrictEqual(calls[0].input, request.args);
		});
	});

	suite('formatToolResultsMessage()', () => {
		test('fences output containing ``` so it cannot close the block early (#16)', () => {
			const output = 'Body:\n```jinja\n{{ x }}\n```\nend';
			const results = [{ callId: 'c1', content: [new vscode.LanguageModelTextPart(output)] }];
			const calls = new Map([['c1', { name: 'read_file', input: { path: 'a.jinja' } }]]);
			const message = formatToolResultsMessage(results, calls);
			assert.ok(message.includes('### read_file {"path":"a.jinja"}'));
			assert.ok(message.includes('````\n' + output + '\n````'), 'output wrapped in a four-backtick fence');
		});

		test('uses a plain triple-backtick fence for backtick-free output', () => {
			const results = [{ callId: 'c1', content: [new vscode.LanguageModelTextPart('plain output')] }];
			const calls = new Map([['c1', { name: 'list_files', input: undefined }]]);
			assert.ok(formatToolResultsMessage(results, calls).includes('```\nplain output\n```'));
		});

		test('keeps multiple ``` blocks from separate web_search results intact (#16)', () => {
			// web_search joins results with blank lines; a scraped snippet can carry its own ``` block.
			const output = [
				'Loop in Jinja\nhttps://ex.com/a\nUse a for loop:\n```jinja\n{% for x in xs %}{{ x }}{% endfor %}\n```',
				'Filter a list\nhttps://ex.com/b\nTry:\n```python\n[x for x in xs if x]\n```',
			].join('\n\n');
			const results = [{ callId: 'c1', content: [new vscode.LanguageModelTextPart(output)] }];
			const calls = new Map([['c1', { name: 'web_search', input: { query: 'jinja loop' } }]]);
			const message = formatToolResultsMessage(results, calls);
			// One outer fence, longer than the inner runs, so neither result's block closes it early.
			assert.ok(message.includes('````\n' + output + '\n````'), 'whole result wrapped in a four-backtick fence');
			assert.ok(message.includes('```jinja\n{% for x in xs %}{{ x }}{% endfor %}\n```'), 'first block survives');
			assert.ok(message.includes('```python\n[x for x in xs if x]\n```'), 'second block survives');
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
