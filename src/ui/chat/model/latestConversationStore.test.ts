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

	test('clears call ids for the previous conversation once a newer latest is stored', () => {
		const store = new LatestConversationStore();
		store.storeLatest('turn-1', 'conv-1');
		store.bindCallIds(['call-1'], 'turn-1', 'conv-1');

		const previous = store.lookup('turn-1');
		store.storeLatest('turn-2', 'conv-2', previous);

		assert.strictEqual(store.lookupByCallIds(['call-1']), undefined);
		assert.deepStrictEqual(store.lookup('turn-2'), { key: 'turn-2', conversationId: 'conv-2' });
	});
});
