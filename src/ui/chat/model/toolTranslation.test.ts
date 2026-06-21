import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import {
	buildInstructionsForChatTools,
	collectToolCalls,
	extractTrailingToolResults,
	rejectedToolsNote,
	translateToolRequests,
} from './toolTranslation';

const { suite, test } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

function chatTool(name: string, description = `${name} tool`): vscode.LanguageModelChatTool {
	return { name, description, inputSchema: { type: 'object' } };
}

function fence(request: object): string {
	return '```vscode-tool\n' + JSON.stringify(request) + '\n```';
}

suite('Unit: toolTranslation', () => {
	suite('buildInstructionsForChatTools()', () => {
		test('advertises built-in tools passed by VS Code without Rewst-only examples', () => {
			const instructions = buildInstructionsForChatTools([chatTool('read_file', 'read a file')]);
			assert.ok(instructions.includes('read_file'));
			assert.ok(instructions.includes('read a file'));
			assert.ok(!instructions.includes('list_template_links'));
			assert.ok(!instructions.includes('buddy_graphql'));
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
		assert.ok(!note.includes('rewst-buddy.ai'), 'chat rejection note does not mention retired Rewst tool settings');
	});
});
