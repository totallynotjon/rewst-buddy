import * as assert from 'assert';
import { suite, test } from '../../test/tdd';
import { ProxyConversationCache, transcriptKey } from './conversationCache';

suite('Unit: Anthropic conversation cache', () => {
	test('key is deterministic and input-sensitive', () => {
		const lines = ['USER: hello', 'ASSISTANT: world'];
		const k1 = transcriptKey('org-1', 'sys', lines);
		const k2 = transcriptKey('org-1', 'sys', lines);
		assert.strictEqual(k1, k2, 'same inputs → same key');
		assert.ok(/^[0-9a-f]{64}$/.test(k1), 'key should be 64-char hex (sha256)');

		// Varying each input changes the key
		assert.notStrictEqual(transcriptKey('org-2', 'sys', lines), k1, 'different orgId');
		assert.notStrictEqual(transcriptKey('org-1', 'sys2', lines), k1, 'different system');
		assert.notStrictEqual(transcriptKey('org-1', 'sys', ['USER: hello']), k1, 'fewer lines');
		assert.notStrictEqual(
			transcriptKey('org-1', 'sys', ['ASSISTANT: world', 'USER: hello']),
			k1,
			'different order',
		);
	});

	test('store then lookup', () => {
		const cache = new ProxyConversationCache();
		cache.store('k1', 'c1');
		assert.strictEqual(cache.lookup('k1'), 'c1');
		assert.strictEqual(cache.lookup('unknown'), undefined);
	});

	test('one live key per conversation', () => {
		const cache = new ProxyConversationCache();
		cache.store('k1', 'c1');
		const evicted = cache.store('k2', 'c1');
		// k1 should be gone (same conversationId advanced to k2)
		assert.strictEqual(cache.lookup('k1'), undefined, 'old key should be removed');
		assert.strictEqual(cache.lookup('k2'), 'c1', 'new key should resolve');
		// No self-eviction
		assert.deepStrictEqual(evicted, [], 'no evictions when only advancing the key');
	});

	test('LRU eviction returns evicted ids', () => {
		const cache = new ProxyConversationCache(2);
		cache.store('k1', 'c1');
		cache.store('k2', 'c2');
		// Touch c1 to make it recently used
		cache.lookup('k1');
		// Adding c3 should evict c2 (least recently used)
		const evicted = cache.store('k3', 'c3');
		assert.deepStrictEqual(evicted, ['c2'], 'c2 should be evicted');
		assert.strictEqual(cache.lookup('k1'), 'c1', 'c1 still resolvable');
		assert.strictEqual(cache.lookup('k3'), 'c3', 'c3 still resolvable');
		assert.strictEqual(cache.lookup('k2'), undefined, 'c2 evicted');
	});

	test('forget drops by conversationId', () => {
		const cache = new ProxyConversationCache();
		cache.store('k1', 'c1');
		cache.forget('c1');
		assert.strictEqual(cache.lookup('k1'), undefined, 'key should be gone after forget');
		// forget of unknown id is a no-op
		assert.doesNotThrow(() => cache.forget('nonexistent'));
	});
});
