import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { CapabilityContext } from './Capability';
import {
	MCP_MAX_OUTPUT_CHARS,
	McpResultCache,
	RESULT_READ_TOOL_NAME,
	_resetMcpResultCacheForTesting,
	formatMcpOutput,
	mcpResultCache,
	resultReadCapability,
} from './resultReadCapability';

const { suite, test, setup } = Mocha;

function cacheId(result: ReturnType<McpResultCache['store']>): string {
	assert.ok('id' in result, 'result was stored');
	return result.id;
}

function ignoredContext(): CapabilityContext {
	return undefined as unknown as CapabilityContext;
}

suite('Unit: resultReadCapability', () => {
	setup(() => {
		initTestEnvironment();
		_resetMcpResultCacheForTesting();
	});

	suite('formatMcpOutput', () => {
		test('returns output inline when it is at or below the threshold', () => {
			const cache = new McpResultCache();
			const text = 'x'.repeat(MCP_MAX_OUTPUT_CHARS);

			assert.strictEqual(formatMcpOutput('buddy_search_templates', text, cache), text);
			assert.strictEqual(cache.size, 0);
		});

		test('caches oversized output and returns preview with paging instructions', () => {
			const cache = new McpResultCache();
			const text = `${'x'.repeat(MCP_MAX_OUTPUT_CHARS)}tail`;
			const formatted = formatMcpOutput('buddy_search_templates', text, cache);

			assert.ok(formatted.startsWith(text.slice(0, MCP_MAX_OUTPUT_CHARS)));
			assert.match(formatted, /cached in memory as id "[0-9a-f]{8}"/);
			assert.ok(formatted.includes(`"offset":${MCP_MAX_OUTPUT_CHARS}`));
			assert.ok(formatted.includes(RESULT_READ_TOOL_NAME));
			assert.ok(formatted.includes(`{"id":"`));
			assert.ok(formatted.includes(`"search":"<text>"`));
			assert.doesNotMatch(formatted, /\bMCP tool\b|\bMCP-only\b/);
			assert.strictEqual(cache.size, 1);
		});

		test('passes buddy_result_read output through without re-caching it', () => {
			const cache = new McpResultCache();
			const text = 'x'.repeat(MCP_MAX_OUTPUT_CHARS + 1);

			assert.strictEqual(formatMcpOutput(RESULT_READ_TOOL_NAME, text, cache), text);
			assert.strictEqual(cache.size, 0);
		});

		test('returns a preview with a cache-budget note when the result is too large to store', () => {
			const cache = new McpResultCache(8);
			const text = 'x'.repeat(MCP_MAX_OUTPUT_CHARS + 1);
			const formatted = formatMcpOutput('buddy_search_templates', text, cache);

			assert.ok(formatted.startsWith(text.slice(0, MCP_MAX_OUTPUT_CHARS)));
			assert.ok(formatted.includes('exceeds the in-memory cache budget'));
			assert.strictEqual(cache.size, 0);
		});
	});

	suite('buddy_result_read run', () => {
		// --- Zod parse tests ---
		test('missing id throws with the expected message', async () => {
			await assert.rejects(
				() => resultReadCapability.run({}, ignoredContext()),
				/buddy_result_read requires an "id"/,
			);
		});

		test('empty string id throws with the expected message', async () => {
			await assert.rejects(
				() => resultReadCapability.run({ id: '' }, ignoredContext()),
				/buddy_result_read requires an "id"/,
			);
		});

		test('numeric string offset and limit are accepted', async () => {
			const id = cacheId(mcpResultCache.store('buddy_search_templates', '0123456789abcdef'));
			const output = await resultReadCapability.run({ id, offset: '4', limit: '6' }, ignoredContext());
			assert.ok(output.includes('456789'));
		});

		test('buddy_result_read derived schema has id required and args generated', () => {
			const schema = resultReadCapability.spec.inputSchema as { required: string[] };
			assert.ok(schema.required.includes('id'));
			assert.strictEqual(resultReadCapability.spec.args, JSON.stringify(schema));
		});

		test('returns a requested slice with a continuation footer', async () => {
			const id = cacheId(mcpResultCache.store('buddy_search_templates', '0123456789abcdef'));

			const output = await resultReadCapability.run({ id, offset: '4', limit: '6' }, ignoredContext());

			assert.ok(output.startsWith(`Cached result "${id}" (buddy_search_templates), characters 4-10 of 16.`));
			assert.ok(output.includes('\n\n456789\n'));
			assert.ok(output.includes(`{"id":"${id}","offset":10}`));
		});

		test('marks the final slice as the end of the result', async () => {
			const id = cacheId(mcpResultCache.store('buddy_search_templates', '0123456789abcdef'));

			const output = await resultReadCapability.run({ id, offset: 10, limit: 100 }, ignoredContext());

			assert.ok(output.includes('abcdef'));
			assert.ok(output.endsWith('(end of result)'));
		});

		test('searches matching lines with line numbers and caps hits', async () => {
			const lines = Array.from({ length: 60 }, (_, i) => `row ${i + 1} target value`);
			const id = cacheId(mcpResultCache.store('buddy_graphql_query', lines.join('\n')));

			const output = await resultReadCapability.run({ id, search: 'target' }, ignoredContext());
			const hitLines = output.split('\n').filter(line => /^\d+:/.test(line));

			assert.strictEqual(hitLines.length, 50);
			assert.ok(hitLines[0].startsWith('1: row 1 target'));
			assert.ok(hitLines[49].startsWith('50: row 50 target'));
			assert.ok(output.includes('10 more matching line(s)'));
		});

		test('search clamps long matching lines', async () => {
			const id = cacheId(mcpResultCache.store('buddy_graphql_query', `${'x'.repeat(600)} target`));

			const output = await resultReadCapability.run({ id, search: 'target' }, ignoredContext());
			const hit = output.split('\n').find(line => line.startsWith('1: '));

			assert.ok(hit);
			assert.ok(hit.length < 520);
			assert.ok(hit.endsWith('...'));
		});

		test('throws a clear error when id is missing', async () => {
			await assert.rejects(
				resultReadCapability.run({}, ignoredContext()),
				(error: unknown) => error instanceof Error && error.message.includes('requires an "id"'),
			);
		});

		test('throws a clear error when the cached id is absent or evicted', async () => {
			await assert.rejects(
				resultReadCapability.run({ id: 'missing1' }, ignoredContext()),
				(error: unknown) =>
					error instanceof Error &&
					error.message.includes('No cached Rewst Buddy result for id "missing1"') &&
					error.message.includes('rerun the original tool'),
			);
		});
	});

	suite('McpResultCache', () => {
		test('evicts oldest entries when storing a new result would exceed the budget', () => {
			const cache = new McpResultCache(10);
			const first = cacheId(cache.store('first_tool', '123456'));
			const second = cacheId(cache.store('second_tool', 'abcdef'));

			assert.strictEqual(cache.get(first), undefined);
			assert.strictEqual(cache.get(second)?.text, 'abcdef');
			assert.strictEqual(cache.size, 1);
			assert.strictEqual(cache.usedBytes, 6);
		});
	});
});
