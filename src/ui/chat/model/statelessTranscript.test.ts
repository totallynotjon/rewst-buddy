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

suite('Unit: statelessTranscript', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('serializes visible user and assistant text in order', () => {
		const transcript = serializeVisibleChat([
			message(User, [text('what is a trigger?')]),
			message(Assistant, [text('An event that starts a workflow.')]),
			message(User, [text('give me an example')]),
		]);

		assert.match(transcript, /<visible_chat_transcript>/);
		assert.ok(transcript.indexOf('USER: what is a trigger?') < transcript.indexOf('ASSISTANT:'));
		assert.match(transcript, /ASSISTANT: An event that starts a workflow\./);
		assert.match(transcript, /USER: give me an example/);
	});

	test('includes tool calls and tool results by tool name', () => {
		const call = new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.txt' });
		const result = new vscode.LanguageModelToolResultPart('call-1', [text('file contents')]);
		const transcript = serializeVisibleChat([
			message(User, [text('check a.txt')]),
			message(Assistant, [text('Looking.'), call]),
			message(User, [result]),
		]);

		assert.match(transcript, /Requested editor tool: read_file \{"path":"a\.txt"\}/);
		assert.match(transcript, /Editor tool result: read_file \{"path":"a\.txt"\}/);
		assert.match(transcript, /file contents/);
	});

	test('strips activity lines from assistant text', () => {
		const transcript = serializeVisibleChat([
			message(User, [text('hi')]),
			message(Assistant, [text('Before\n> _Searching documentation..._\nAfter')]),
		]);

		assert.match(transcript, /Before\s+After/);
		assert.ok(!transcript.includes('Searching documentation'));
	});
});
