import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import {
	buildToolInstructions,
	codeFence,
	describeRequest,
	describeRequestBrief,
	MAX_REQUESTS_PER_TURN,
	parseToolRequests,
	stripToolRequestBlocks,
	TOOL_FENCE_MARKER,
	TOOL_FENCE_TAG,
} from './toolProtocol';

const { suite, test, setup } = Mocha;

function fence(body: string): string {
	return TOOL_FENCE_MARKER + '\n' + body + '\n```';
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

		test('parses a request whose args carry a ``` code block (#16)', () => {
			const request = { tool: 'update_template_body', args: { body: '# Title\n```jinja\n{{ x }}\n```\n' } };
			const content = `Saving the template.\n${fence(JSON.stringify(request))}`;
			assert.deepStrictEqual(parseToolRequests(content), [request]);
		});

		test('parses a tool call written with a raw multi-line ``` code block (#16)', () => {
			// RoboRewsty writes the body as a real multi-line fenced block: literal
			// newlines inside the JSON string, fence on its own lines. That is invalid
			// JSON and used to split the call in two, dropping it.
			const content = [
				'```vscode-tool',
				'{"tool": "update_template_body", "args": {"body": "# Title',
				'```jinja',
				'{{ x }}',
				'```',
				'"}}',
				'```',
			].join('\n');
			assert.deepStrictEqual(parseToolRequests(content), [
				{ tool: 'update_template_body', args: { body: '# Title\n```jinja\n{{ x }}\n```\n' } },
			]);
		});

		test('lifts sibling keys into args when the model omits the args wrapper (#16)', () => {
			// RoboRewsty sometimes writes the arguments flat, alongside `tool`, with no
			// `args` object — the query was dropped and the call ran with empty args.
			const content = fence(
				'{"tool": "rewst_graphql", "query": "{ workflows { id } }", "variables": {"orgId": "o1"}}',
			);
			assert.deepStrictEqual(parseToolRequests(content), [
				{ tool: 'rewst_graphql', args: { query: '{ workflows { id } }', variables: { orgId: 'o1' } } },
			]);
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
			assert.ok(!stripped.includes(TOOL_FENCE_TAG));
		});

		test('removes a backtick-carrying tool block whole, leaking no fragments (#16)', () => {
			const request = { tool: 'update_template_body', args: { body: '```jinja\n{{ x }}\n```' } };
			const content = `Saving.\n${fence(JSON.stringify(request))}\nDone.`;
			const stripped = stripToolRequestBlocks(content);
			assert.ok(stripped.includes('Saving.'));
			assert.ok(stripped.includes('Done.'));
			assert.ok(!stripped.includes(TOOL_FENCE_TAG));
			assert.ok(!stripped.includes('jinja'));
		});
	});

	suite('codeFence()', () => {
		test('wraps plain text in a triple-backtick fence', () => {
			assert.strictEqual(codeFence('hello'), '```\nhello\n```');
		});

		test('uses a longer fence than a ``` block inside the text', () => {
			const wrapped = codeFence('before\n```\ncode\n```\nafter');
			assert.ok(wrapped.startsWith('````\n'), 'opens with four backticks');
			assert.ok(wrapped.endsWith('\n````'), 'closes with four backticks');
			assert.ok(wrapped.includes('```\ncode\n```'), 'keeps the inner block verbatim');
		});

		test('grows the fence to outrun the longest backtick run', () => {
			const wrapped = codeFence('a ````` b');
			assert.ok(wrapped.startsWith('``````\n'), 'six backticks outrun a run of five');
		});
	});

	suite('buildToolInstructions()', () => {
		test('lists every tool with args and mentions the fence tag', () => {
			const text = buildToolInstructions([
				{ name: 'read_file', args: '{"path": string}', description: 'Read a file.' },
				{ name: 'list_files', args: '{}', description: 'List files.' },
			]);
			assert.ok(text.includes(TOOL_FENCE_TAG));
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

	suite('describeRequestBrief()', () => {
		test('passes short labels through unchanged', () => {
			assert.strictEqual(
				describeRequestBrief({ tool: 'read_file', args: { path: 'a' } }),
				'read_file {"path":"a"}',
			);
		});

		test('truncates labels past the cap with an ellipsis', () => {
			const brief = describeRequestBrief({ tool: 'rewst_graphql', args: { query: 'q'.repeat(300) } }, 40);
			assert.strictEqual(brief.length, 40);
			assert.ok(brief.startsWith('rewst_graphql {"query":"qqq'));
			assert.ok(brief.endsWith('…'));
		});

		test('never exceeds a non-positive or tiny cap', () => {
			assert.strictEqual(describeRequestBrief({ tool: 'read_file', args: { path: 'a' } }, 0), '');
			assert.strictEqual(describeRequestBrief({ tool: 'read_file', args: { path: 'a' } }, -5), '');
			assert.strictEqual(describeRequestBrief({ tool: 'read_file', args: { path: 'a' } }, 1), '…');
		});
	});
});
