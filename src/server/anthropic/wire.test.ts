import * as assert from 'assert';
import { suite, test } from '../../test/tdd';
import { buildToolInstructions } from '../../ui/chat/tools/toolProtocol';
import type { Completion } from './wire';
import {
	buildBackendMessage,
	buildReuseTurnMessage,
	entryLine,
	estimateTokens,
	mapCompletion,
	MAX_ENTRY_CHARS,
	newMessageId,
	newToolUseId,
	parseAnthropicRequest,
	predictedAssistantLine,
	toToolSpecs,
} from './wire';

// ---------------------------------------------------------------------------
// parseAnthropicRequest
// ---------------------------------------------------------------------------

suite('Unit: Anthropic wire — parseAnthropicRequest', () => {
	test('accepts a minimal request', () => {
		const result = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.ok(!('error' in result), `unexpected error: ${'error' in result ? result.error : ''}`);
		if ('error' in result) return;
		assert.strictEqual(result.model, 'm');
		assert.strictEqual(result.messages.length, 1);
		assert.deepStrictEqual(result.messages[0].parts, ['hi']);
		assert.deepStrictEqual(result.tools, []);
		assert.strictEqual(result.stream, false);
		assert.strictEqual(result.system, undefined);
	});

	test('rejects non-object body / missing model / empty messages', () => {
		const r1 = parseAnthropicRequest(null);
		assert.ok('error' in r1, 'null body should fail');
		assert.ok(r1.error.length > 0);

		const r2 = parseAnthropicRequest({ messages: [{ role: 'user', content: 'hi' }] });
		assert.ok('error' in r2, 'missing model should fail');
		assert.ok(r2.error.toLowerCase().includes('model'));

		const r3 = parseAnthropicRequest({ model: 'm', messages: [] });
		assert.ok('error' in r3, 'empty messages should fail');
		assert.ok(r3.error.toLowerCase().includes('messages'));
	});

	test('rejects unknown role', () => {
		const result = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'system', content: 'hi' }],
		});
		assert.ok('error' in result);
		assert.ok(result.error.toLowerCase().includes('role'));
	});

	test('normalizes array system', () => {
		const result = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
			system: [
				{ type: 'text', text: 'a' },
				{ type: 'text', text: 'b' },
			],
		});
		assert.ok(!('error' in result));
		if ('error' in result) return;
		assert.strictEqual(result.system, 'a\n\nb');

		const r2 = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
			system: 42,
		});
		assert.ok('error' in r2, 'non-array non-string system should fail');
	});

	test('serializes tool_use and pairs tool_result by id', () => {
		const result = parseAnthropicRequest({
			model: 'm',
			messages: [
				{
					role: 'assistant',
					content: [
						{ type: 'text', text: 'doing' },
						{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a' } },
					],
				},
				{
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 't1',
							content: [{ type: 'text', text: 'DATA' }],
						},
					],
				},
			],
		});
		assert.ok(!('error' in result));
		if ('error' in result) return;
		const assistantParts = result.messages[0].parts;
		assert.ok(assistantParts.includes('doing'));
		assert.ok(assistantParts.some(p => p.includes('Requested editor tool: read_file') && p.includes('"path":"a"')));
		const userParts = result.messages[1].parts;
		assert.ok(userParts.some(p => p.startsWith('Editor tool result: read_file\nDATA')));
	});

	test('tool_result with unknown id and is_error', () => {
		const result = parseAnthropicRequest({
			model: 'm',
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'nope',
							is_error: true,
							content: 'boom',
						},
					],
				},
			],
		});
		assert.ok(!('error' in result));
		if ('error' in result) return;
		const part = result.messages[0].parts[0];
		assert.strictEqual(part, 'Editor tool result: tool (error)\nboom');
	});

	test('drops thinking, notes non-text blocks', () => {
		const result = parseAnthropicRequest({
			model: 'm',
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'thinking', thinking: 'thinking-secret-content' },
						{ type: 'image', source: {} },
					],
				},
			],
		});
		assert.ok(!('error' in result));
		if ('error' in result) return;
		const parts = result.messages[0].parts;
		// thinking is dropped — its content must not appear in any part
		assert.ok(!parts.some(p => p.includes('thinking-secret-content')));
		// image becomes placeholder
		assert.ok(parts.some(p => p.includes('[non-text content omitted]')));
	});

	test('ignores sampling params, honors stream flag', () => {
		const result = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
			max_tokens: 1000,
			temperature: 0.5,
			stream: true,
		});
		assert.ok(!('error' in result));
		if ('error' in result) return;
		assert.strictEqual(result.stream, true);

		const r2 = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
			stream: 'true',
		});
		assert.ok(!('error' in r2));
		if ('error' in r2) return;
		assert.strictEqual(r2.stream, false);
	});

	test('rejects tools without a name', () => {
		const result = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
			tools: [{ description: 'x' }],
		});
		assert.ok('error' in result);
		assert.ok(result.error.toLowerCase().includes('tools'));
	});
});

// ---------------------------------------------------------------------------
// buildBackendMessage
// ---------------------------------------------------------------------------

suite('Unit: Anthropic wire — buildBackendMessage', () => {
	test('orders SYSTEM then transcript inside the wrapper', () => {
		const req = parseAnthropicRequest({
			model: 'm',
			system: 'S',
			messages: [
				{ role: 'user', content: 'u1' },
				{ role: 'assistant', content: 'a1' },
			],
		});
		assert.ok(!('error' in req));
		if ('error' in req) return;
		const out = buildBackendMessage(req);
		assert.ok(out.includes('<conversation_transcript>'));
		assert.ok(out.includes('</conversation_transcript>'));
		const sysIdx = out.indexOf('SYSTEM:\nS');
		const userIdx = out.indexOf('USER: u1');
		const asstIdx = out.indexOf('ASSISTANT: a1');
		assert.ok(sysIdx >= 0, 'SYSTEM entry missing');
		assert.ok(userIdx >= 0, 'USER entry missing');
		assert.ok(asstIdx >= 0, 'ASSISTANT entry missing');
		assert.ok(sysIdx < userIdx, 'SYSTEM should come before USER');
		assert.ok(userIdx < asstIdx, 'USER should come before ASSISTANT');
		// No tool instructions when tools empty
		assert.ok(!out.includes('Available tools:'));
	});

	test('appends verbatim tool instructions when tools present', () => {
		const tools = [{ name: 'read_file', input_schema: { type: 'object' } }];
		const req = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
			tools,
		});
		assert.ok(!('error' in req));
		if ('error' in req) return;
		const out = buildBackendMessage(req);
		const expected = buildToolInstructions(toToolSpecs(req.tools));
		assert.ok(out.endsWith(expected), 'tool instructions must appear verbatim at the end');
		const transcriptEnd = out.indexOf('</conversation_transcript>');
		const toolStart = out.indexOf(expected);
		assert.ok(toolStart > transcriptEnd, 'tool instructions must appear after </conversation_transcript>');
	});

	test('truncates an oversized entry', () => {
		const longContent = 'x'.repeat(MAX_ENTRY_CHARS + 100);
		const req = parseAnthropicRequest({
			model: 'm',
			messages: [{ role: 'user', content: longContent }],
		});
		assert.ok(!('error' in req));
		if ('error' in req) return;
		const out = buildBackendMessage(req);
		assert.ok(out.includes('...(truncated)'));
		// The entry should not contain the full content
		assert.ok(!out.includes(longContent));
	});

	test('drops oldest entries over the total cap, keeps SYSTEM and last', () => {
		// 40 user/assistant pairs of 10_000 chars each = 800_000 chars total > MAX_TOTAL_CHARS
		const messages: { role: 'user' | 'assistant'; content: string }[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push({ role: 'user', content: `user-msg-${i}-` + 'A'.repeat(9990) });
			messages.push({ role: 'assistant', content: `asst-msg-${i}-` + 'B'.repeat(9990) });
		}
		const req = parseAnthropicRequest({
			model: 'm',
			system: 'SYSTEM_CONTENT',
			messages,
		});
		assert.ok(!('error' in req));
		if ('error' in req) return;
		const out = buildBackendMessage(req);
		assert.ok(out.includes('earlier message(s) omitted'), 'should note omitted messages');
		assert.ok(out.includes('SYSTEM_CONTENT'), 'SYSTEM entry must be kept');
		// Last entry must be present
		assert.ok(out.includes('asst-msg-19-'), 'last entry must be kept');
		// First user entry should be gone
		assert.ok(!out.includes('user-msg-0-' + 'A'.repeat(9990)), 'oldest entry should be dropped');
	});

	test('skips empty messages', () => {
		const req = parseAnthropicRequest({
			model: 'm',
			messages: [
				{ role: 'user', content: 'first' },
				// thinking-only message serializes to empty parts
				{ role: 'user', content: [{ type: 'thinking', thinking: 'internal' }] },
				{ role: 'user', content: 'last' },
			],
		});
		assert.ok(!('error' in req));
		if ('error' in req) return;
		const out = buildBackendMessage(req);
		// Should not have an empty USER: line
		assert.ok(!out.includes('USER: \n'), 'no empty USER line');
		assert.ok(!out.match(/USER:\s*\n\s*USER:/), 'no consecutive empty USER lines');
	});
});

// ---------------------------------------------------------------------------
// mapCompletion
// ---------------------------------------------------------------------------

suite('Unit: Anthropic wire — mapCompletion', () => {
	test('text only', () => {
		const result = mapCompletion('hello', new Set(['read_file']));
		assert.strictEqual(result.text, 'hello');
		assert.deepStrictEqual(result.toolUses, []);
		assert.strictEqual(result.stopReason, 'end_turn');
	});

	test('parses an advertised tool request', () => {
		const fence = '\n```vscode-tool\n{"tool":"read_file","args":{"path":"x"}}\n```';
		const content = 'some prose' + fence;
		const result = mapCompletion(content, new Set(['read_file']));
		assert.strictEqual(result.toolUses.length, 1);
		assert.strictEqual(result.toolUses[0].name, 'read_file');
		assert.deepStrictEqual(result.toolUses[0].input, { path: 'x' });
		assert.ok(/^toolu_[0-9a-f]{24}$/.test(result.toolUses[0].id));
		assert.ok(!result.text.includes('vscode-tool'), 'fence should be stripped from text');
		assert.strictEqual(result.stopReason, 'tool_use');
	});

	test('drops an unadvertised tool with a note', () => {
		const fence = '\n```vscode-tool\n{"tool":"write_file","args":{}}\n```';
		const result = mapCompletion(fence, new Set(['read_file']));
		assert.deepStrictEqual(result.toolUses, []);
		assert.ok(result.text.includes('Ignored tool request for unknown tool: write_file'));
		assert.strictEqual(result.stopReason, 'end_turn');
	});

	test('no tools advertised → fences untouched', () => {
		const fence = '\n```vscode-tool\n{"tool":"read_file","args":{}}\n```';
		const content = 'prose' + fence;
		const result = mapCompletion(content, new Set());
		assert.strictEqual(result.text, content);
		assert.strictEqual(result.stopReason, 'end_turn');
	});

	test('multiple requests in one reply', () => {
		const fence =
			'\n```vscode-tool\n[{"tool":"read_file","args":{"path":"a"}},{"tool":"read_file","args":{"path":"b"}}]\n```';
		const result = mapCompletion(fence, new Set(['read_file']));
		assert.strictEqual(result.toolUses.length, 2);
		assert.notStrictEqual(result.toolUses[0].id, result.toolUses[1].id);
	});
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

suite('Unit: Anthropic wire — helpers', () => {
	test('estimateTokens', () => {
		assert.strictEqual(estimateTokens(''), 0);
		assert.strictEqual(estimateTokens('abcd'), 1);
		assert.strictEqual(estimateTokens('abcde'), 2);
	});

	test('newMessageId format and uniqueness', () => {
		const id1 = newMessageId();
		const id2 = newMessageId();
		assert.ok(/^msg_[0-9a-f]{24}$/.test(id1), `bad format: ${id1}`);
		assert.notStrictEqual(id1, id2);
	});

	test('newToolUseId format', () => {
		const id = newToolUseId();
		assert.ok(/^toolu_[0-9a-f]{24}$/.test(id), `bad format: ${id}`);
	});
});

// ---------------------------------------------------------------------------
// reuse serialization
// ---------------------------------------------------------------------------

suite('Unit: Anthropic wire — reuse serialization', () => {
	test('predictedAssistantLine matches the parse round-trip', () => {
		const completion: Completion = {
			text: 'ok',
			toolUses: [
				{
					type: 'tool_use',
					id: 'toolu_x',
					name: 'read_file',
					input: { path: 'a' },
				},
			],
			stopReason: 'tool_use',
		};

		// Build the echo request that a client would send after receiving this completion
		const echoReq = parseAnthropicRequest({
			model: 'm',
			messages: [
				{
					role: 'assistant',
					content: [
						{ type: 'text', text: 'ok' },
						{ type: 'tool_use', id: 'toolu_x', name: 'read_file', input: { path: 'a' } },
					],
				},
			],
		});
		assert.ok(!('error' in echoReq));
		if ('error' in echoReq) return;

		const predicted = predictedAssistantLine(completion);
		const parsed = entryLine('assistant', echoReq.messages[0].parts);
		assert.strictEqual(predicted, parsed, 'byte-exact invariant for reuse cache key');
	});

	test('text-only completion predicts text-only line', () => {
		const completion: Completion = { text: 'ok', toolUses: [], stopReason: 'end_turn' };
		assert.strictEqual(predictedAssistantLine(completion), 'ASSISTANT: ok');
	});

	test('buildReuseTurnMessage joins tail and appends tool instructions', () => {
		const req = parseAnthropicRequest({
			model: 'm',
			messages: [
				{ role: 'user', content: 'msg1' },
				{ role: 'user', content: 'msg2' },
			],
			tools: [{ name: 'read_file', description: 'reads a file', input_schema: { type: 'object' } }],
		});
		assert.ok(!('error' in req));
		if ('error' in req) return;

		const specs = toToolSpecs(req.tools);
		const msg = buildReuseTurnMessage(req.messages, specs);
		assert.ok(msg.includes('msg1'));
		assert.ok(msg.includes('msg2'));
		assert.ok(!msg.includes('<conversation_transcript>'), 'no wrapper in reuse turn');
		const expected = buildToolInstructions(specs);
		assert.ok(msg.endsWith(expected), 'tool instructions appended');

		// With empty specs, no instructions appended
		const msgNoTools = buildReuseTurnMessage(req.messages, []);
		assert.ok(!msgNoTools.includes('Available tools:'));
	});
});
