import * as assert from 'assert';
import * as Mocha from 'mocha';
import { LatestConversationStore } from './latestConversationStore';

const { suite, test } = Mocha;

suite('Unit: LatestConversationStore', () => {
	test('stores and replaces the latest conversation for a visible chat key', () => {
		const store = new LatestConversationStore();
		store.storeLatest('turn-1', 'conv-1');
		assert.deepStrictEqual(store.lookup('turn-1'), { key: 'turn-1', conversationId: 'conv-1' });

		const previous = store.lookup('turn-1');
		store.storeLatest('turn-2', 'conv-2', previous);

		assert.strictEqual(store.lookup('turn-1'), undefined);
		assert.deepStrictEqual(store.lookup('turn-2'), { key: 'turn-2', conversationId: 'conv-2' });
	});

	test('binds call ids without replacing the retained conversation key', () => {
		const store = new LatestConversationStore();
		store.storeLatest('turn-1', 'conv-1');
		store.bindCallIds(['call-1'], 'turn-2', 'conv-2');

		assert.deepStrictEqual(store.lookup('turn-1'), { key: 'turn-1', conversationId: 'conv-1' });
		assert.deepStrictEqual(store.lookupByCallIds(['call-1']), { key: 'turn-2', conversationId: 'conv-2' });
	});

	test('pending tool calls remember the previous latest conversation', () => {
		const store = new LatestConversationStore();
		const previous = { key: 'turn-1', conversationId: 'conv-1' };
		store.bindCallIds(['call-1'], 'turn-2', 'conv-2', previous);

		assert.deepStrictEqual(store.lookupByCallIds(['call-1']), {
			key: 'turn-2',
			conversationId: 'conv-2',
			previousLatest: previous,
		});
	});

	test('clears call ids for the previous conversation once a newer latest is stored', () => {
		const store = new LatestConversationStore();
		store.storeLatest('turn-1', 'conv-1');
		store.bindCallIds(['call-1'], 'turn-1', 'conv-1');

		const previous = store.lookup('turn-1');
		store.storeLatest('turn-2', 'conv-2', previous);

		assert.strictEqual(store.lookupByCallIds(['call-1']), undefined);
		assert.deepStrictEqual(store.lookup('turn-2'), { key: 'turn-2', conversationId: 'conv-2' });
	});

	test('evicts the least-recently-used retained key past the cap', () => {
		const store = new LatestConversationStore();
		for (let i = 0; i < 300; i++) store.storeLatest(`turn-${i}`, `conv-${i}`);

		assert.strictEqual(store.lookup('turn-0'), undefined, 'oldest key was evicted');
		assert.deepStrictEqual(store.lookup('turn-299'), { key: 'turn-299', conversationId: 'conv-299' });
	});

	test('looking up a retained key keeps it alive across eviction', () => {
		const store = new LatestConversationStore();
		// Fill to the cap without overflowing yet.
		for (let i = 0; i < 128; i++) store.storeLatest(`turn-${i}`, `conv-${i}`);

		store.lookup('turn-0'); // touch to MRU
		store.storeLatest('turn-128', 'conv-128'); // overflow by one

		assert.deepStrictEqual(store.lookup('turn-0'), { key: 'turn-0', conversationId: 'conv-0' });
		assert.strictEqual(store.lookup('turn-1'), undefined, 'the untouched oldest key was evicted instead');
	});

	test('evicts the oldest bound call ids past the cap', () => {
		const store = new LatestConversationStore();
		for (let i = 0; i < 400; i++) store.bindCallIds([`call-${i}`], `turn-${i}`, `conv-${i}`);

		assert.strictEqual(store.lookupByCallIds(['call-0']), undefined, 'oldest call id was evicted');
		assert.deepStrictEqual(store.lookupByCallIds(['call-399']), { key: 'turn-399', conversationId: 'conv-399' });
	});
});
