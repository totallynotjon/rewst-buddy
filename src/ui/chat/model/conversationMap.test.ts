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
			// Turn 1: [user]. The provider emits "Hello there".
			const turn1 = [message(User, [text('hi')])];
			const stored = nextTurnKey('org-1', turn1);

			// Turn 2 arrives with the assistant reply consolidated into one part.
			const turn2 = [
				message(User, [text('hi')]),
				message(Assistant, [text('Hello there')]),
				message(User, [text('next question')]),
			];
			assert.strictEqual(prefixKey('org-1', turn2), stored);
		});

		test('continuity holds when the replayed assistant text drifts from what was emitted', () => {
			// The bug: turn 1 answered with a large table streamed through internal
			// tools; VS Code re-serialized the assistant turn with different bytes
			// than we streamed. A key that includes assistant text would miss here
			// and spawn a fresh backend conversation, losing the whole chat.
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
			// Assistant content must not change the key: only the user spine counts.
			const withAssistant = serializeHistory([message(User, [text('x')]), message(Assistant, [text('y')])]);
			const userOnly = serializeHistory([message(User, [text('x')])]);
			assert.strictEqual(withAssistant, userOnly);

			// Differing user turns still produce differing spines.
			const other = serializeHistory([message(User, [text('x')]), message(User, [text('y')])]);
			assert.notStrictEqual(withAssistant, other);
		});
	});

	suite('ConversationMap', () => {
		test('stores and looks up conversation ids', () => {
			const map = new ConversationMap();
			map.store('key-1', 'conv-1', 1);
			assert.strictEqual(map.lookup('key-1'), 'conv-1');
			assert.strictEqual(map.lookup('key-2'), undefined);
		});

		test('interleaved chats keep distinct conversations', () => {
			const map = new ConversationMap();
			const chatA = prefixKey('org-1', [message(User, [text('A history')]), message(User, [text('q')])]);
			const chatB = prefixKey('org-1', [message(User, [text('B history')]), message(User, [text('q')])]);
			map.store(chatA, 'conv-A', 1);
			map.store(chatB, 'conv-B', 1);
			assert.strictEqual(map.lookup(chatA), 'conv-A');
			assert.strictEqual(map.lookup(chatB), 'conv-B');
		});

		test('a prefix behind the conversation tip reads as a miss (rewind fork)', () => {
			const map = new ConversationMap();
			// Turn 1 and turn 2 of one chat advance the same conversation.
			map.store('key-turn-1', 'conv-1', 1);
			map.store('key-turn-2', 'conv-1', 2);
			assert.strictEqual(map.lookup('key-turn-2'), 'conv-1', 'tip prefix re-attaches');
			// Restore Checkpoint replays the turn-1 prefix: the backend
			// conversation still holds turn 2, so re-attaching is a miss.
			assert.strictEqual(map.lookup('key-turn-1'), undefined, 'rewound prefix forks');
		});

		test('the forked conversation tracks its own tip independently', () => {
			const map = new ConversationMap();
			map.store('key-turn-1', 'conv-1', 1);
			map.store('key-turn-2', 'conv-1', 2);
			// After the fork, the same depth-1 spine continues conv-2.
			map.store('key-turn-1b', 'conv-2', 1);
			assert.strictEqual(map.lookup('key-turn-1b'), 'conv-2', 'fork is at its own tip');
			map.store('key-turn-2b', 'conv-2', 2);
			assert.strictEqual(map.lookup('key-turn-1b'), undefined, 'rewinding the fork forks again');
			// The old conversation's TIP still re-attaches: at that spine the
			// backend holds exactly those turns, so continuing it is correct.
			assert.strictEqual(map.lookup('key-turn-2'), 'conv-1');
		});

		test('a rewound miss does not keep the dead entry alive at the expense of live ones', () => {
			const map = new ConversationMap();
			map.store('rewound', 'conv-1', 1);
			map.store('tip', 'conv-1', 2);
			// Fill the cache to capacity, then trigger one eviction. The rewound
			// entry can never re-attach, so the miss must not refresh it — the
			// eviction should take it, not the live tip entry.
			for (let i = 0; i < MAX_ENTRIES - 2; i++) {
				map.store(`filler-${i}`, `conv-filler-${i}`, 1);
			}
			assert.strictEqual(map.lookup('rewound'), undefined, 'rewound prefix still misses');
			map.store('one-more', 'conv-one-more', 1);
			assert.strictEqual(map.lookup('tip'), 'conv-1', 'live tip entry survives the eviction');
		});

		test('a replayed behind-tip store keeps rewind detection alive under cache pressure', () => {
			const map = new ConversationMap();
			map.store('rewound', 'conv-1', 1);
			map.store('tip', 'conv-1', 2);
			for (let i = 0; i < 100; i++) {
				map.store(`filler-${i}`, `conv-filler-${i}`, 1);
			}
			// VS Code replays the turn-1 request: the provider re-stores the same
			// key at its old depth. That refreshes the entry's recency, so the
			// conversation's tip record must stay at least as recent — otherwise
			// the tip evicts first and the stale entry re-attaches to a backend
			// conversation that still holds the rolled-back turn 2.
			map.store('rewound', 'conv-1', 1);
			for (let i = 100; i < MAX_ENTRIES + 1; i++) {
				map.store(`filler-${i}`, `conv-filler-${i}`, 1);
			}
			assert.strictEqual(map.lookup('rewound'), undefined, 'rewound prefix still forks');
		});

		test('spineDepth counts only user turns', () => {
			assert.strictEqual(spineDepth([]), 0);
			assert.strictEqual(
				spineDepth([message(User, [text('a')]), message(Assistant, [text('b')]), message(User, [text('c')])]),
				2,
			);
		});

		test('callId binding recovers the conversation regardless of message hash', () => {
			const map = new ConversationMap();
			map.storeByCallIds(['call-a', 'call-b'], 'conv-7');
			assert.strictEqual(map.lookupByCallIds(['call-b']), 'conv-7');
			assert.strictEqual(map.lookupByCallIds(['unknown', 'call-a']), 'conv-7');
			assert.strictEqual(map.lookupByCallIds(['nope']), undefined);
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
