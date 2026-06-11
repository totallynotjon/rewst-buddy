import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import {
	blockedRepeatResult,
	buildToolInstructions,
	describeRequest,
	formatToolResults,
	MAX_REQUESTS_PER_TURN,
	MAX_RESULT_CHARS,
	MAX_TOTAL_RESULT_CHARS,
	parseToolRequests,
	RequestDeduper,
	stripToolRequestBlocks,
	type ToolResult,
} from './toolProtocol';

const { suite, test, setup } = Mocha;

function fence(body: string): string {
	return '```rewst-tool\n' + body + '\n```';
}

suite('Unit: toolProtocol', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('parseToolRequests()', () => {
		test('parses a single request object', () => {
			const content = `Let me look.\n\n${fence('{"tool": "read_file", "args": {"path": "a.jinja"}}')}`;
			assert.deepStrictEqual(parseToolRequests(content), [{ tool: 'read_file', args: { path: 'a.jinja' } }]);
		});

		test('parses an array of requests and multiple fences', () => {
			const content = [
				fence('[{"tool": "list_files"}, {"tool": "list_open_files", "args": {}}]'),
				fence('{"tool": "search_files", "args": {"query": "foo"}}'),
			].join('\n');
			assert.deepStrictEqual(parseToolRequests(content), [
				{ tool: 'list_files', args: {} },
				{ tool: 'list_open_files', args: {} },
				{ tool: 'search_files', args: { query: 'foo' } },
			]);
		});

		test('ignores malformed JSON, missing tool names, and bad args', () => {
			const content = [
				fence('not json'),
				fence('{"args": {"path": "a"}}'),
				fence('{"tool": 42}'),
				fence('{"tool": "read_file", "args": ["nope"]}'),
				fence('{"tool": "list_files"}'),
			].join('\n');
			assert.deepStrictEqual(parseToolRequests(content), [{ tool: 'list_files', args: {} }]);
		});

		test('returns empty for ordinary answers and plain code blocks', () => {
			assert.deepStrictEqual(parseToolRequests('Use `template()` like this:\n```jinja\n{{ x }}\n```'), []);
		});

		test('caps requests per turn', () => {
			const many = Array.from({ length: MAX_REQUESTS_PER_TURN + 3 }, () => '{"tool": "list_files"}');
			const content = fence(`[${many.join(',')}]`);
			assert.strictEqual(parseToolRequests(content).length, MAX_REQUESTS_PER_TURN);
		});
	});

	suite('stripToolRequestBlocks()', () => {
		test('removes fences but keeps surrounding prose and normal code blocks', () => {
			const content = `Checking.\n${fence('{"tool": "list_files"}')}\n\`\`\`jinja\n{{ x }}\n\`\`\``;
			const stripped = stripToolRequestBlocks(content);
			assert.ok(stripped.includes('Checking.'));
			assert.ok(stripped.includes('{{ x }}'));
			assert.ok(!stripped.includes('rewst-tool'));
		});
	});

	suite('buildToolInstructions()', () => {
		test('lists every tool with args and mentions the fence tag', () => {
			const text = buildToolInstructions([
				{ name: 'read_file', args: '{"path": string}', description: 'Read a file.' },
				{ name: 'list_files', args: '{}', description: 'List files.' },
			]);
			assert.ok(text.includes('rewst-tool'));
			assert.ok(text.includes('read_file — args: {"path": string}'));
			assert.ok(text.includes('list_files'));
		});

		test('adds explicit GraphQL guidance when GraphQL tools are available', () => {
			const text = buildToolInstructions([
				{ name: 'rewst_graphql_schema', args: '{}', description: 'Inspect schema.' },
				{ name: 'rewst_graphql', args: '{"query": string}', description: 'Run GraphQL.' },
			]);
			assert.ok(text.includes('session-authenticated GraphQL action'));
			assert.ok(text.includes('Use rewst_graphql_schema first'));
			assert.ok(text.includes('then call rewst_graphql'));
		});
	});

	suite('describeRequest()', () => {
		test('omits empty args and includes non-empty args', () => {
			assert.strictEqual(describeRequest({ tool: 'list_files', args: {} }), 'list_files');
			assert.strictEqual(describeRequest({ tool: 'read_file', args: { path: 'a' } }), 'read_file {"path":"a"}');
		});
	});

	suite('RequestDeduper', () => {
		const read = (path: string) => ({ tool: 'read_file', args: { path } });
		const edit = (path: string) => ({ tool: 'edit_file', args: { path, find: 'a', replace: 'b' } });

		test('drops duplicate requests within one reply', () => {
			const { run, blocked } = new RequestDeduper().filter([read('a.ts'), read('a.ts'), read('b.ts')], 0);
			assert.deepStrictEqual(
				run.map(r => r.args.path),
				['a.ts', 'b.ts'],
			);
			assert.strictEqual(blocked.length, 0);
		});

		test('blocks identical repeats across rounds', () => {
			const deduper = new RequestDeduper();
			assert.strictEqual(deduper.filter([read('a.ts')], 0).run.length, 1);
			const { run, blocked } = deduper.filter([read('a.ts'), read('b.ts')], 1);
			assert.deepStrictEqual(
				run.map(r => r.args.path),
				['b.ts'],
			);
			assert.deepStrictEqual(
				blocked.map(r => r.args.path),
				['a.ts'],
			);
		});

		test('different args are not repeats', () => {
			const deduper = new RequestDeduper();
			deduper.filter([{ tool: 'read_file', args: { path: 'a.ts' } }], 0);
			const { run } = deduper.filter([{ tool: 'read_file', args: { path: 'a.ts', startLine: 250 } }], 1);
			assert.strictEqual(run.length, 1);
		});

		test('allows re-reads after an edit changed the workspace', () => {
			const deduper = new RequestDeduper();
			deduper.filter([read('a.ts')], 0);
			deduper.filter([edit('a.ts')], 1);
			const { run, blocked } = deduper.filter([read('a.ts')], 2);
			assert.strictEqual(run.length, 1);
			assert.strictEqual(blocked.length, 0);
		});

		test('never blocks edit tools', () => {
			const deduper = new RequestDeduper();
			deduper.filter([edit('a.ts')], 0);
			const { run, blocked } = deduper.filter([edit('a.ts')], 1);
			assert.strictEqual(run.length, 1);
			assert.strictEqual(blocked.length, 0);
		});

		test('blockedRepeatResult nudges instead of re-running', () => {
			const result = blockedRepeatResult(read('a.ts'));
			assert.strictEqual(result.ok, false);
			assert.match(result.output, /Do not repeat identical calls/);
		});
	});

	suite('formatToolResults()', () => {
		const result = (over: Partial<ToolResult>): ToolResult => ({
			tool: 'read_file',
			argsLabel: '{"path":"a"}',
			ok: true,
			output: 'body',
			...over,
		});

		test('labels results and marks errors', () => {
			const text = formatToolResults([
				result({}),
				result({ tool: 'list_files', argsLabel: '', ok: false, output: 'boom' }),
			]);
			assert.ok(text.startsWith('Tool results:'));
			assert.ok(text.includes('### read_file {"path":"a"}\n```\nbody\n```'));
			assert.ok(text.includes('### list_files (error)\n```\nboom\n```'));
			assert.ok(text.includes('final answer'));
		});

		test('truncates per-result and total budgets', () => {
			const big = 'x'.repeat(MAX_RESULT_CHARS + 1000);
			const text = formatToolResults([
				result({ output: big }),
				result({ output: big }),
				result({ output: big }),
				result({ output: big }),
			]);
			assert.ok(text.includes('…(truncated)'));
			assert.ok(
				text.length < MAX_TOTAL_RESULT_CHARS + 2_000,
				`formatted length ${text.length} should stay near total budget`,
			);
		});
	});
});
