import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import vscode from 'vscode';
import { serializeVisibleChat } from './statelessTranscript';

const { suite, test, setup } = Mocha;
const { User, Assistant } = vscode.LanguageModelChatMessageRole;

function message(role: vscode.LanguageModelChatMessageRole, content: unknown[]) {
	return { role, content, name: undefined };
}

function text(value: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(value);
}

function flatten(chunks: ReturnType<typeof serializeVisibleChat>): string {
	return chunks.map(chunk => `${chunk.role}: ${chunk.content}`).join('\n');
}

suite('Unit: statelessTranscript', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('serializes visible user and assistant text in order with explicit roles', () => {
		const chunks = serializeVisibleChat([
			message(User, [text('what is a trigger?')]),
			message(Assistant, [text('An event that starts a workflow.')]),
			message(User, [text('give me an example')]),
		]);

		assert.deepStrictEqual(
			chunks.map(chunk => chunk.role),
			['USER', 'ASSISTANT', 'USER'],
		);
		const transcript = flatten(chunks);
		assert.ok(transcript.indexOf('USER: what is a trigger?') < transcript.indexOf('ASSISTANT:'));
		assert.match(transcript, /ASSISTANT: An event that starts a workflow\./);
		assert.match(transcript, /USER: give me an example/);
	});

	test('includes tool calls and tool results by tool name', () => {
		const call = new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.txt' });
		const result = new vscode.LanguageModelToolResultPart('call-1', [text('file contents')]);
		const chunks = serializeVisibleChat([
			message(User, [text('check a.txt')]),
			message(Assistant, [text('Looking.'), call]),
			message(User, [result]),
		]);
		const transcript = flatten(chunks);

		assert.match(transcript, /Requested editor tool: read_file \{"path":"a\.txt"\}/);
		assert.match(transcript, /Editor tool result: read_file \{"path":"a\.txt"\}/);
		assert.match(transcript, /file contents/);
		assert.strictEqual(chunks.find(chunk => chunk.content.startsWith('Requested editor tool'))?.role, 'USER');
	});

	test('strips activity lines from assistant text', () => {
		const transcript = flatten(
			serializeVisibleChat([
				message(User, [text('hi')]),
				message(Assistant, [text('Before\n> _Searching documentation..._\nAfter')]),
			]),
		);

		assert.match(transcript, /Before\s+After/);
		assert.ok(!transcript.includes('Searching documentation'));
	});

	test('caps and frames terminal tool output as likely-unrelated', () => {
		const call = new vscode.LanguageModelToolCallPart('call-1', 'run_in_terminal', { command: 'ls' });
		const longOutput = 'x'.repeat(5_000);
		const result = new vscode.LanguageModelToolResultPart('call-1', [text(longOutput)]);
		const transcript = flatten(
			serializeVisibleChat([
				message(User, [text('what does the terminal say?')]),
				message(Assistant, [call]),
				message(User, [result]),
			]),
		);

		assert.match(transcript, /Editor tool result: run_in_terminal/);
		assert.match(
			transcript,
			/raw terminal output — likely unrelated to the current request unless the user explicitly asked about the terminal/,
		);
		assert.ok(!transcript.includes(longOutput), 'terminal output is capped');
	});

	test('does not apply the tighter terminal cap to non-terminal output', () => {
		const call = new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.txt' });
		const longOutput = 'y'.repeat(5_000);
		const result = new vscode.LanguageModelToolResultPart('call-1', [text(longOutput)]);
		const transcript = flatten(
			serializeVisibleChat([
				message(User, [text('check a.txt')]),
				message(Assistant, [call]),
				message(User, [result]),
			]),
		);

		assert.ok(!transcript.includes('raw terminal output'));
		assert.ok(transcript.includes(longOutput));
	});

	test('skips system/provider-only messages and merges adjacent same-role entries', () => {
		const chunks = serializeVisibleChat([
			message('system' as unknown as vscode.LanguageModelChatMessageRole, [text('do not seed this')]),
			message(User, [text('one'), text('two')]),
			message(Assistant, [text('answer')]),
		]);

		assert.deepStrictEqual(chunks, [
			{ role: 'USER', content: 'one\ntwo' },
			{ role: 'ASSISTANT', content: 'answer' },
		]);
	});

	test('drops oldest entries when the total seed budget is exceeded', () => {
		const chunks = serializeVisibleChat(
			Array.from({ length: 10 }, (_, index) =>
				message(index % 2 === 0 ? User : Assistant, [text(`turn-${index} ${'x'.repeat(48_000)}`)]),
			),
		);

		assert.ok(chunks.length > 0);
		assert.ok(flatten(chunks).includes('turn-9'), 'latest entry survives');
		assert.match(flatten(chunks), /earlier message\(s\) omitted/);
		assert.ok(chunks.every(chunk => chunk.content.length <= 50_000));
	});

	test('enforces the total seed budget after same-role merges and omission markers', () => {
		const chunks = serializeVisibleChat(
			Array.from({ length: 20 }, () => message(User, [text('x'.repeat(20_000))])),
		);

		assert.ok(chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) <= 400_000);
		assert.match(flatten(chunks), /earlier message\(s\) omitted/);
	});
});
