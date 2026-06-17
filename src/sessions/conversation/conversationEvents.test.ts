import * as assert from 'assert';
import * as Mocha from 'mocha';
import { ConversationEventMapper, type ConversationEvent } from './conversationEvents';

const { suite, test, setup } = Mocha;

suite('Unit: ConversationEventMapper', () => {
	let mapper: ConversationEventMapper;

	setup(() => {
		mapper = new ConversationEventMapper();
	});

	test('maps request_registered to registered with requestId', () => {
		const events = mapper.map({ status: 'request_registered', metadata: { requestId: 'req-1' } });
		assert.deepStrictEqual(events, [{ kind: 'registered', requestId: 'req-1' }]);
	});

	test('emits conversation once when conversation_id first appears', () => {
		const first = mapper.map({ status: 'thinking', conversation_id: 'conv-1' });
		assert.deepStrictEqual(first, [
			{ kind: 'conversation', conversationId: 'conv-1' },
			{ kind: 'status', label: 'Thinking…' },
		]);

		const second = mapper.map({ status: 'summarizing', conversation_id: 'conv-1' });
		assert.deepStrictEqual(second, [{ kind: 'status', label: 'Summarizing conversation…' }]);
	});

	test('maps known progress statuses to labels', () => {
		const searching = mapper.map({ status: 'searching', metadata: { queries: ['a'] } });
		assert.deepStrictEqual(searching, [{ kind: 'status', label: 'Searching documentation…', activity: true }]);

		const streamingThinking = mapper.map({ status: 'streaming_thinking' });
		assert.deepStrictEqual(streamingThinking, [{ kind: 'status', label: 'Thinking…' }]);
	});

	test('maps TOOL_CALL_IN_PROGRESS with tool name', () => {
		const events = mapper.map({
			status: 'TOOL_CALL_IN_PROGRESS',
			metadata: { toolCalls: [{ name: 'gitbook_retriever', id: 't1' }] },
		});
		assert.deepStrictEqual(events, [
			{
				kind: 'status',
				label: 'Running Rewst tool: gitbook_retriever…',
				activity: true,
				tool: { name: 'gitbook_retriever' },
			},
		]);
	});

	test('TOOL_CALL_IN_PROGRESS shows a compact preview of the tool args', () => {
		const events = mapper.map({
			status: 'TOOL_CALL_IN_PROGRESS',
			metadata: { toolCalls: [{ name: 'gitbook_retriever', args: { query: 'noop tasks' }, id: 't2' }] },
		});
		assert.deepStrictEqual(events, [
			{
				kind: 'status',
				label: 'Running Rewst tool: gitbook_retriever {"query":"noop tasks"}…',
				activity: true,
				tool: { name: 'gitbook_retriever', args: '{"query":"noop tasks"}' },
			},
		]);
	});

	test('TOOL_CALL_IN_PROGRESS truncates oversized args', () => {
		const events = mapper.map({
			status: 'TOOL_CALL_IN_PROGRESS',
			metadata: { toolCalls: [{ name: 'buddy_graphql', args: { query: 'q'.repeat(500) }, id: 't3' }] },
		});
		const label = events[0].kind === 'status' ? events[0].label : '';
		assert.ok(label.startsWith('Running Rewst tool: buddy_graphql {"query":"qqq'), 'keeps the head of the args');
		assert.ok(label.endsWith('…'), 'ends with the truncation marker');
		assert.ok(label.length < 140, `label is bounded, got ${label.length}`);
	});

	test('ignores bookkeeping statuses', () => {
		for (const status of ['summarization_complete', 'search_complete', 'TOOL_CALL_COMPLETE']) {
			assert.deepStrictEqual(mapper.map({ status }), [], `expected no events for ${status}`);
		}
	});

	test('maps context_usage to a usage event', () => {
		const events = mapper.map({
			status: 'context_usage',
			metadata: { totalTokens: 60500, maxTokens: 144000, percent: 42, agentName: 'roborewsty_supervisor' },
		});
		assert.deepStrictEqual(events, [{ kind: 'usage', totalTokens: 60500, maxTokens: 144000, percent: 42 }]);
	});

	test('context_usage computes percent when the backend omits it', () => {
		const events = mapper.map({ status: 'context_usage', metadata: { totalTokens: 36000, maxTokens: 144000 } });
		assert.deepStrictEqual(events, [{ kind: 'usage', totalTokens: 36000, maxTokens: 144000, percent: 25 }]);
	});

	test('context_usage drops payloads missing the total or window size', () => {
		assert.deepStrictEqual(mapper.map({ status: 'context_usage', metadata: { totalTokens: 100 } }), []);
		assert.deepStrictEqual(mapper.map({ status: 'context_usage', metadata: { maxTokens: 144000 } }), []);
		assert.deepStrictEqual(
			mapper.map({ status: 'context_usage', metadata: { totalTokens: 100, maxTokens: 0 } }),
			[],
		);
		assert.deepStrictEqual(mapper.map({ status: 'context_usage' }), []);
	});

	test('ignores unknown statuses (forward-compatible)', () => {
		assert.deepStrictEqual(mapper.map({ status: 'SOME_FUTURE_STATUS' }), []);
	});

	test('emits delta chunks as-is', () => {
		const a = mapper.map({ status: 'streaming_response', metadata: { partialContent: 'Hello ' } });
		const b = mapper.map({ status: 'streaming_response', metadata: { partialContent: 'world' } });
		assert.deepStrictEqual(a, [{ kind: 'chunk', text: 'Hello ' }]);
		assert.deepStrictEqual(b, [{ kind: 'chunk', text: 'world' }]);
	});

	test('emits only suffix for cumulative chunks', () => {
		mapper.map({ status: 'streaming_response', metadata: { partialContent: 'Hello' } });
		const events = mapper.map({ status: 'streaming_response', metadata: { partialContent: 'Hello world' } });
		assert.deepStrictEqual(events, [{ kind: 'chunk', text: ' world' }]);
	});

	test('suppresses repeated identical cumulative chunk', () => {
		mapper.map({ status: 'streaming_response', metadata: { partialContent: 'Hello' } });
		const events = mapper.map({ status: 'streaming_response', metadata: { partialContent: 'Hello' } });
		assert.deepStrictEqual(events, []);
	});

	test('suppresses a full resend of an already-streamed segment', () => {
		// RoboRewsty resets its cumulative base after an internal tool call and
		// resends a sentence it already streamed; it must not render twice.
		mapper.map({ status: 'streaming_response', metadata: { partialContent: 'Let me check the schema.' } });
		const resend = mapper.map({
			status: 'streaming_response',
			metadata: { partialContent: 'Let me check the schema.' },
		});
		assert.deepStrictEqual(resend, []);
	});

	test('emits only the non-overlapping remainder when a resent segment then grows', () => {
		mapper.map({ status: 'streaming_response', metadata: { partialContent: 'The tool returned no count.' } });
		// New cumulative base repeats the tail, then extends it.
		const grown = mapper.map({
			status: 'streaming_response',
			metadata: { partialContent: 'The tool returned no count. Let me try a larger page.' },
		});
		assert.deepStrictEqual(grown, [{ kind: 'chunk', text: ' Let me try a larger page.' }]);
	});

	test('a genuinely new segment with no overlap still streams', () => {
		mapper.map({ status: 'streaming_response', metadata: { partialContent: 'First part.' } });
		const next = mapper.map({ status: 'streaming_response', metadata: { partialContent: 'Totally separate.' } });
		assert.deepStrictEqual(next, [{ kind: 'chunk', text: 'Totally separate.' }]);
	});

	test('maps complete with content, sources, conversationId, messageId', () => {
		mapper.map({ status: 'thinking', conversation_id: 'conv-9' });
		const events = mapper.map({
			status: 'complete',
			message: { id: 'msg-1', content: 'Final answer', role: 'ASSISTANT' },
			metadata: {
				sources: [
					{ label: 'Workflows', source: 'https://docs.rewst.help/workflows', section: 'Intro' },
					{ notASource: true },
				],
			},
		});
		assert.deepStrictEqual(events, [
			{
				kind: 'complete',
				content: 'Final answer',
				sources: [{ label: 'Workflows', source: 'https://docs.rewst.help/workflows', section: 'Intro' }],
				conversationId: 'conv-9',
				messageId: 'msg-1',
			},
		]);
	});

	test('complete without message content falls back to streamed text', () => {
		mapper.map({ status: 'streaming_response', metadata: { partialContent: 'Streamed answer' } });
		const events = mapper.map({ status: 'complete' });
		assert.strictEqual(events.length, 1);
		const complete = events[0] as Extract<ConversationEvent, { kind: 'complete' }>;
		assert.strictEqual(complete.content, 'Streamed answer');
		assert.deepStrictEqual(complete.sources, []);
	});

	test('maps error status with string error field', () => {
		const events = mapper.map({ status: 'error', error: 'Something broke' });
		assert.deepStrictEqual(events, [{ kind: 'error', message: 'Something broke' }]);
	});

	test('maps error status without error field to generic message', () => {
		const events = mapper.map({ status: 'error' });
		assert.deepStrictEqual(events, [{ kind: 'error', message: 'The Rewst AI assistant returned an error.' }]);
	});

	test('maps interrupted and conversation_killed to errors', () => {
		for (const status of ['interrupted', 'conversation_killed']) {
			const events = mapper.map({ status });
			assert.strictEqual(events.length, 1, `expected one event for ${status}`);
			assert.strictEqual(events[0].kind, 'error');
		}
	});

	test('maps approval_required to an approval event with parsed tools', () => {
		const events = mapper.map({
			status: 'approval_required',
			metadata: {
				requestId: 'req-7',
				toolCalls: [{ name: 'create_workflow', args: { name: 'Daily' }, id: 'tc-1' }],
			},
		});
		assert.deepStrictEqual(events, [
			{
				kind: 'approval',
				tools: [{ name: 'create_workflow', args: { name: 'Daily' }, id: 'tc-1' }],
				requestId: 'req-7',
				raw: {
					requestId: 'req-7',
					toolCalls: [{ name: 'create_workflow', args: { name: 'Daily' }, id: 'tc-1' }],
				},
			},
		]);
	});

	test('approval_required inherits the tool from the preceding TOOL_CALL_IN_PROGRESS', () => {
		mapper.map({ status: 'request_registered', metadata: { requestId: 'req-9' } });
		mapper.map({
			status: 'TOOL_CALL_IN_PROGRESS',
			metadata: { toolCalls: [{ name: 'listOrgVariable', args: { orgId: 'o1' }, id: 'tc-9' }] },
		});
		const events = mapper.map({ status: 'approval_required', metadata: {} });
		assert.deepStrictEqual(events, [
			{
				kind: 'approval',
				tools: [{ name: 'listOrgVariable', args: { orgId: 'o1' }, id: 'tc-9' }],
				requestId: 'req-9',
				raw: {},
			},
		]);
	});

	test('approval_required reuses the requestId from an earlier request_registered', () => {
		mapper.map({ status: 'request_registered', metadata: { requestId: 'req-earlier' } });
		const events = mapper.map({ status: 'approval_required', metadata: {} });
		assert.strictEqual(events.length, 1);
		const approval = events[0] as Extract<ConversationEvent, { kind: 'approval' }>;
		assert.strictEqual(approval.requestId, 'req-earlier');
		assert.deepStrictEqual(approval.tools, []);
		assert.deepStrictEqual(approval.raw, {});
	});

	test('handles null/undefined payloads', () => {
		assert.deepStrictEqual(mapper.map(null), []);
		assert.deepStrictEqual(mapper.map(undefined), []);
	});
});
