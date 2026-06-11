import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { ConversationMap, nextTurnKey, prefixKey, serializeHistory } from './conversationMap';

const { suite, test } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

function message(role: vscode.LanguageModelChatMessageRole, content: unknown[]) {
	return { role, content };
}

function text(value: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(value);
}

suite('Unit: conversationMap', () => {
	suite('keying', () => {
		test('consecutive turns of one chat compute matching keys', () => {
			// Turn 1: [user]. The provider emits "Hello there".
			const turn1 = [message(User, [text('hi')])];
			const stored = nextTurnKey('org-1', turn1, ['Hello there']);

			// Turn 2 arrives with the assistant reply consolidated into one part.
			const turn2 = [
				message(User, [text('hi')]),
				message(Assistant, [text('Hello there')]),
				message(User, [text('next question')]),
			];
			assert.strictEqual(prefixKey('org-1', turn2), stored);
		});

		test('chunked emission serializes identically to consolidated text', () => {
			const turn1 = [message(User, [text('hi')])];
			const chunked = nextTurnKey('org-1', turn1, ['Hello ', 'there']);
			const whole = nextTurnKey('org-1', turn1, ['Hello there']);
			assert.strictEqual(chunked, whole);
		});

		test('tool-call parts key consistently across emission and replay', () => {
			const call = new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.txt' });
			const turn1 = [message(User, [text('check a.txt')])];
			const stored = nextTurnKey('org-1', turn1, ['Let me look', call]);

			const turn2 = [
				message(User, [text('check a.txt')]),
				message(Assistant, [text('Let me look'), call]),
				message(User, [new vscode.LanguageModelToolResultPart('call-1', [text('contents')])]),
			];
			assert.strictEqual(prefixKey('org-1', turn2), stored);
		});

		test('distinct orgs produce distinct keys for identical content', () => {
			const messages = [message(User, [text('hi')]), message(User, [text('again')])];
			assert.notStrictEqual(prefixKey('org-1', messages), prefixKey('org-2', messages));
		});

		test('distinct content produces distinct keys', () => {
			const a = [message(User, [text('alpha')]), message(User, [text('x')])];
			const b = [message(User, [text('beta')]), message(User, [text('x')])];
			assert.notStrictEqual(prefixKey('org-1', a), prefixKey('org-1', b));
		});

		test('serializeHistory separates roles', () => {
			const a = serializeHistory([message(User, [text('x')]), message(Assistant, [text('y')])]);
			const b = serializeHistory([message(User, [text('x')]), message(User, [text('y')])]);
			assert.notStrictEqual(a, b);
		});
	});

	suite('ConversationMap', () => {
		test('stores and looks up conversation ids', () => {
			const map = new ConversationMap();
			map.store('key-1', 'conv-1');
			assert.strictEqual(map.lookup('key-1'), 'conv-1');
			assert.strictEqual(map.lookup('key-2'), undefined);
		});

		test('interleaved chats keep distinct conversations', () => {
			const map = new ConversationMap();
			const chatA = prefixKey('org-1', [message(User, [text('A history')]), message(User, [text('q')])]);
			const chatB = prefixKey('org-1', [message(User, [text('B history')]), message(User, [text('q')])]);
			map.store(chatA, 'conv-A');
			map.store(chatB, 'conv-B');
			assert.strictEqual(map.lookup(chatA), 'conv-A');
			assert.strictEqual(map.lookup(chatB), 'conv-B');
		});

		test('pending resume is one-shot per org', () => {
			const map = new ConversationMap();
			map.setPendingResume('org-1', 'conv-9');
			assert.strictEqual(map.takePendingResume('org-2'), undefined);
			assert.strictEqual(map.takePendingResume('org-1'), 'conv-9');
			assert.strictEqual(map.takePendingResume('org-1'), undefined, 'consumed bindings do not repeat');
		});
	});
});
