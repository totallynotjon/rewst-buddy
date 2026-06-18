import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { SessionManager } from '@sessions';
import { ToolOutputCache, formatToolOutput, runResultReadTool } from './toolOutputCache';

const { suite, test, setup, teardown } = Mocha;

const SMALL_LIMIT = () => 1_000_000; // 1 MB, plenty for these tests

suite('Unit: toolOutputCache', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
	});

	suite('formatToolOutput()', () => {
		test('returns short output inline without caching', () => {
			const cache = new ToolOutputCache(SMALL_LIMIT);
			const out = formatToolOutput('buddy_graphql', 'tiny', cache);
			assert.strictEqual(out, 'tiny');
			assert.strictEqual(cache.size, 0);
		});

		test('caches oversized output and returns a preview plus an id', () => {
			const cache = new ToolOutputCache(SMALL_LIMIT);
			const big = 'z'.repeat(20_000);
			const out = formatToolOutput('buddy_graphql', big, cache);
			assert.match(out, /cached in memory as id "([0-9a-f]+)"/);
			assert.match(out, /buddy_result_read/);
			assert.ok(out.includes('z'.repeat(8_000)), 'includes the 8000-char preview');
			assert.ok(!out.includes('z'.repeat(8_001)), 'does not dump the whole result');
			assert.strictEqual(cache.size, 1);
		});

		test('passes buddy_result_read output through without re-caching', () => {
			const cache = new ToolOutputCache(SMALL_LIMIT);
			const big = 'z'.repeat(20_000);
			const out = formatToolOutput('buddy_result_read', big, cache);
			assert.strictEqual(out, big);
			assert.strictEqual(cache.size, 0);
		});

		test('falls back to a truncated preview when output exceeds the cache budget', () => {
			const cache = new ToolOutputCache(() => 1_000); // 1 KB budget
			const big = 'z'.repeat(20_000);
			const out = formatToolOutput('buddy_graphql', big, cache);
			assert.match(out, /exceeds the in-memory tool-result cache limit/);
			assert.match(out, /toolResultCacheLimitMB/);
			assert.strictEqual(cache.size, 0);
		});
	});

	suite('ToolOutputCache eviction', () => {
		test('evicts the oldest entries to stay within the byte budget', () => {
			const cache = new ToolOutputCache(() => 25_000); // fits ~2 of the 12k entries
			const first = cache.store('buddy_graphql', 'a'.repeat(12_000));
			const second = cache.store('buddy_graphql', 'b'.repeat(12_000));
			const third = cache.store('buddy_graphql', 'c'.repeat(12_000));
			assert.ok('id' in first && 'id' in second && 'id' in third);
			assert.strictEqual(cache.get(first.id), undefined, 'oldest entry evicted');
			assert.ok(cache.get(second.id), 'second entry retained');
			assert.ok(cache.get(third.id), 'newest entry retained');
			assert.ok(cache.usedBytes <= 25_000);
		});
	});

	suite('runResultReadTool()', () => {
		function cacheWith(text: string): { cache: ToolOutputCache; id: string } {
			const cache = new ToolOutputCache(SMALL_LIMIT);
			const stored = cache.store('buddy_graphql', text);
			assert.ok('id' in stored);
			return { cache, id: stored.id };
		}

		test('slices the cached text by offset/limit and points at the next offset', () => {
			const { cache, id } = cacheWith('0123456789'.repeat(2_000)); // 20_000 chars
			const out = runResultReadTool({ tool: 'buddy_result_read', args: { id, offset: 100, limit: 50 } }, cache);
			assert.match(out, /characters 100–150 of 20000/);
			assert.match(out, /"offset":150/);
		});

		test('marks the end of the result', () => {
			const { cache, id } = cacheWith('abc'.repeat(4_000)); // 12_000 chars
			const out = runResultReadTool({ tool: 'buddy_result_read', args: { id, offset: 11_990 } }, cache);
			assert.match(out, /\(end of result\)/);
		});

		test('search returns matching lines with line numbers', () => {
			const cache = new ToolOutputCache(SMALL_LIMIT);
			const text = ['alpha row', 'beta row', 'alpha again', 'gamma'].join('\n') + '\n' + 'pad'.repeat(4_000);
			const stored = cache.store('buddy_graphql', text);
			assert.ok('id' in stored);
			const out = runResultReadTool(
				{ tool: 'buddy_result_read', args: { id: stored.id, search: 'alpha' } },
				cache,
			);
			assert.match(out, /2 matching line\(s\)/);
			assert.match(out, /1: alpha row/);
			assert.match(out, /3: alpha again/);
			assert.ok(!out.includes('beta'));
		});

		test('search reports when nothing matches', () => {
			const { cache, id } = cacheWith('nothing to see here'.repeat(1_000));
			const out = runResultReadTool({ tool: 'buddy_result_read', args: { id, search: 'absent' } }, cache);
			assert.match(out, /No lines .* match "absent"/);
		});

		test('throws without an id', () => {
			const cache = new ToolOutputCache(SMALL_LIMIT);
			assert.throws(() => runResultReadTool({ tool: 'buddy_result_read', args: {} }, cache), /needs an "id"/);
		});

		test('throws for an unknown id', () => {
			const cache = new ToolOutputCache(SMALL_LIMIT);
			assert.throws(
				() => runResultReadTool({ tool: 'buddy_result_read', args: { id: 'missing' } }, cache),
				/No cached tool result for id "missing"/,
			);
		});
	});
});
