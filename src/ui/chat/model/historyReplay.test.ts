import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { buildHistoryReplay } from './historyReplay';

const { suite, test } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

function message(role: vscode.LanguageModelChatMessageRole, content: unknown[]) {
	return { role, content };
}

function text(value: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(value);
}

suite('Unit: historyReplay', () => {
	test('renders user and assistant turns in order', () => {
		const replay = buildHistoryReplay([
			message(User, [text('what is a trigger?')]),
			message(Assistant, [text('An event that starts a workflow.')]),
		]);
		assert.match(replay, /<chat_transcript_replay>/);
		assert.match(replay, /USER: what is a trigger\?/);
		assert.match(replay, /ASSISTANT: An event that starts a workflow\./);
		assert.ok(replay.indexOf('USER:') < replay.indexOf('ASSISTANT:'));
	});

	test('returns empty string for no replayable content', () => {
		assert.strictEqual(buildHistoryReplay([]), '');
		const call = new vscode.LanguageModelToolCallPart('call-1', 'read_file', {});
		assert.strictEqual(buildHistoryReplay([message(Assistant, [call])]), '');
	});

	test('drops tool parts and activity lines but keeps surrounding text', () => {
		const call = new vscode.LanguageModelToolCallPart('call-1', 'read_file', {});
		const result = new vscode.LanguageModelToolResultPart('call-1', [text('file contents')]);
		const replay = buildHistoryReplay([
			message(User, [text('check the file')]),
			message(Assistant, [text('Looking now.\n> _Searching documentation…_\nFound it.'), call]),
			message(User, [result]),
		]);
		assert.match(replay, /ASSISTANT: Looking now\.\s*\nFound it\./);
		assert.ok(!replay.includes('Searching documentation'), 'activity lines dropped');
		assert.ok(!replay.includes('file contents'), 'tool results dropped');
	});

	test('truncates oversized messages and drops oldest turns over budget', () => {
		const big = 'x'.repeat(3000);
		const turns = Array.from({ length: 10 }, (_, i) =>
			message(i % 2 === 0 ? User : Assistant, [text(`turn ${i} ${big}`)]),
		);
		const replay = buildHistoryReplay(turns);
		assert.match(replay, /…\(truncated\)/);
		assert.match(replay, /\(\d+ earlier message\(s\) omitted\)/);
		assert.ok(!replay.includes('turn 0 '), 'oldest turn dropped');
		assert.match(replay, /turn 9 /);
		assert.ok(replay.length < 14_000, 'total stays near budget');
	});
});
