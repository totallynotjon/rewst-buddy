import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { ConversationMap, MAX_ENTRIES, nextTurnKey, prefixKey, serializeHistory, spineDepth } from './conversationMap';

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
			const turn1 = [message(User, [text('hi')])];
			const stored = nextTurnKey('org-1', turn1);

			const turn2 = [
				message(User, [text('hi')]),
				message(Assistant, [text('Hello there')]),
				message(User, [text('next question')]),
			];
			assert.strictEqual(prefixKey('org-1', turn2), stored);
		});

		test('continuity holds when the replayed assistant text drifts from what was emitted', () => {
			const turn1 = [message(User, [text('list the secret org variables')])];
			const stored = nextTurnKey('org-1', turn1);

			const turn2 = [
				message(User, [text('list the secret org variables')]),
				message(Assistant, [text('<<replayed table — different bytes than we streamed>>')]),
				message(User, [text('use the graphql tool')]),
			];
			assert.strictEqual(prefixKey('org-1', turn2), stored);
		});

		test('tool-call parts key consistently across emission and replay', () => {
			const call = new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.txt' });
			const turn1 = [message(User, [text('check a.txt')])];
			const stored = nextTurnKey('org-1', turn1);

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

		test('serializeHistory excludes assistant messages from the spine', () => {
			const withAssistant = serializeHistory([message(User, [text('x')]), message(Assistant, [text('y')])]);
			const userOnly = serializeHistory([message(User, [text('x')])]);
			assert.strictEqual(withAssistant, userOnly);

			const other = serializeHistory([message(User, [text('x')]), message(User, [text('y')])]);
			assert.notStrictEqual(withAssistant, other);
		});

		test('spineDepth counts only user turns', () => {
			assert.strictEqual(spineDepth([]), 0);
			assert.strictEqual(
				spineDepth([message(User, [text('a')]), message(Assistant, [text('b')]), message(User, [text('c')])]),
				2,
			);
		});
	});

	suite('ConversationMap', () => {
		test('stores and looks up followable conversation ids', () => {
			const map = new ConversationMap();
			map.store('key-1', 'conv-1', 1);
			assert.deepStrictEqual(map.lookup('key-1'), { conversationId: 'conv-1', followable: true });
			assert.strictEqual(map.lookup('key-2'), undefined);
		});

		test('interleaved chats keep distinct conversations', () => {
			const map = new ConversationMap();
			const chatA = prefixKey('org-1', [message(User, [text('A history')]), message(User, [text('q')])]);
			const chatB = prefixKey('org-1', [message(User, [text('B history')]), message(User, [text('q')])]);
			map.store(chatA, 'conv-A', 1);
			map.store(chatB, 'conv-B', 1);
			assert.strictEqual(map.lookup(chatA)?.conversationId, 'conv-A');
			assert.strictEqual(map.lookup(chatB)?.conversationId, 'conv-B');
		});

		test('a prefix behind the conversation tip is unfollowable (rewind fork)', () => {
			const map = new ConversationMap();
			map.store('key-turn-1', 'conv-1', 1);
			map.store('key-turn-2', 'conv-1', 2);
			assert.strictEqual(map.lookup('key-turn-2')?.followable, true, 'tip prefix re-attaches');
			// Restore Checkpoint replays the turn-1 prefix: the backend conversation
			// still holds turn 2, so re-attaching is unfollowable — but it still
			// names the stale conversation so the caller can delete it.
			assert.deepStrictEqual(map.lookup('key-turn-1'), { conversationId: 'conv-1', followable: false });
		});

		test('the forked conversation tracks its own tip independently', () => {
			const map = new ConversationMap();
			map.store('key-turn-1', 'conv-1', 1);
			map.store('key-turn-2', 'conv-1', 2);
			map.store('key-turn-1b', 'conv-2', 1);
			assert.strictEqual(map.lookup('key-turn-1b')?.followable, true, 'fork is at its own tip');
			map.store('key-turn-2b', 'conv-2', 2);
			assert.strictEqual(map.lookup('key-turn-1b')?.followable, false, 'rewinding the fork forks again');
			assert.strictEqual(map.lookup('key-turn-2')?.conversationId, 'conv-1');
		});

		test('a rewound miss does not keep the dead entry alive at the expense of live ones', () => {
			const map = new ConversationMap();
			map.store('rewound', 'conv-1', 1);
			map.store('tip', 'conv-1', 2);
			for (let i = 0; i < MAX_ENTRIES - 2; i++) {
				map.store(`filler-${i}`, `conv-filler-${i}`, 1);
			}
			assert.strictEqual(map.lookup('rewound')?.followable, false, 'rewound prefix is unfollowable');
			map.store('one-more', 'conv-one-more', 1);
			assert.strictEqual(map.lookup('tip')?.conversationId, 'conv-1', 'live tip entry survives the eviction');
		});

		test('a replayed behind-tip store keeps rewind detection alive under cache pressure', () => {
			const map = new ConversationMap();
			map.store('rewound', 'conv-1', 1);
			map.store('tip', 'conv-1', 2);
			for (let i = 0; i < 100; i++) {
				map.store(`filler-${i}`, `conv-filler-${i}`, 1);
			}
			map.store('rewound', 'conv-1', 1);
			for (let i = 100; i < MAX_ENTRIES + 1; i++) {
				map.store(`filler-${i}`, `conv-filler-${i}`, 1);
			}
			assert.strictEqual(map.lookup('rewound')?.followable, false, 'rewound prefix still forks');
		});

		test('callId binding recovers the conversation regardless of message hash', () => {
			const map = new ConversationMap();
			map.storeByCallIds(['call-a', 'call-b'], 'conv-7');
			assert.strictEqual(map.lookupByCallIds(['call-b']), 'conv-7');
			assert.strictEqual(map.lookupByCallIds(['unknown', 'call-a']), 'conv-7');
			assert.strictEqual(map.lookupByCallIds(['nope']), undefined);
		});

		test('breadcrumbFollowable trusts only known, non-rewound conversations', () => {
			const map = new ConversationMap();
			map.store('key-turn-1', 'conv-1', 1);
			map.store('key-turn-2', 'conv-1', 2);
			assert.strictEqual(map.breadcrumbFollowable('conv-1', 2), true, 'at the tip, followable');
			assert.strictEqual(map.breadcrumbFollowable('conv-1', 1), false, 'behind the tip, rewound');
			assert.strictEqual(map.breadcrumbFollowable('conv-unknown', 5), false, 'unknown (reloaded), rejected');
		});

		test('forget removes every trace so a stale conversation never re-attaches', () => {
			const map = new ConversationMap();
			map.store('key-1', 'conv-1', 2);
			map.storeByCallIds(['call-1'], 'conv-1');
			map.forget('conv-1');
			assert.strictEqual(map.lookup('key-1'), undefined);
			assert.strictEqual(map.lookupByCallIds(['call-1']), undefined);
			assert.strictEqual(map.breadcrumbFollowable('conv-1', 2), false);
		});
	});
});
