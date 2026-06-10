import * as assert from 'assert';
import * as Mocha from 'mocha';
import { runConversation } from './ConversationClient';
import { ConversationEventMapper, type ConversationEvent, type RawConversationPayload } from './conversationEvents';

const { suite, test } = Mocha;

type Payload = RawConversationPayload | null | undefined;

async function* scripted(payloads: Payload[], onReturn?: () => void): AsyncGenerator<Payload> {
	try {
		for (const payload of payloads) {
			yield payload;
		}
	} finally {
		onReturn?.();
	}
}

async function collect(generator: AsyncGenerator<ConversationEvent>): Promise<ConversationEvent[]> {
	const events: ConversationEvent[] = [];
	for await (const event of generator) {
		events.push(event);
	}
	return events;
}

suite('Unit: runConversation', () => {
	test('happy path: streams events and terminates on complete', async () => {
		const payloads: Payload[] = [
			{ status: 'request_registered', metadata: { requestId: 'req-1' } },
			{ status: 'thinking', conversation_id: 'conv-1' },
			{ status: 'streaming_response', metadata: { partialContent: 'Hello ' } },
			{ status: 'streaming_response', metadata: { partialContent: 'world' } },
			{ status: 'complete', message: { id: 'm1', content: 'Hello world' }, metadata: { sources: [] } },
			// Must never be reached
			{ status: 'streaming_response', metadata: { partialContent: 'extra' } },
		];

		const events = await collect(
			runConversation(scripted(payloads), new ConversationEventMapper(), { inactivityTimeoutMs: 5_000 }),
		);

		assert.deepStrictEqual(
			events.map(e => e.kind),
			['registered', 'conversation', 'status', 'chunk', 'chunk', 'complete'],
		);
		const complete = events[events.length - 1] as Extract<ConversationEvent, { kind: 'complete' }>;
		assert.strictEqual(complete.content, 'Hello world');
		assert.strictEqual(complete.conversationId, 'conv-1');
	});

	test('terminates on error event', async () => {
		const payloads: Payload[] = [
			{ status: 'thinking', conversation_id: 'conv-1' },
			{ status: 'error', error: 'boom' },
			{ status: 'complete', message: { content: 'never' } },
		];

		const events = await collect(
			runConversation(scripted(payloads), new ConversationEventMapper(), { inactivityTimeoutMs: 5_000 }),
		);

		assert.strictEqual(events[events.length - 1]?.kind, 'error');
		assert.ok(!events.some(e => e.kind === 'complete'));
	});

	test('ends cleanly when the source completes without a terminal event', async () => {
		const payloads: Payload[] = [{ status: 'thinking', conversation_id: 'conv-1' }];

		const events = await collect(
			runConversation(scripted(payloads), new ConversationEventMapper(), { inactivityTimeoutMs: 5_000 }),
		);

		assert.deepStrictEqual(
			events.map(e => e.kind),
			['conversation', 'status'],
		);
	});

	test('yields error and aborts when the source rejects', async () => {
		async function* failing(): AsyncGenerator<Payload> {
			yield { status: 'thinking', conversation_id: 'conv-1' };
			throw new Error('socket exploded');
		}

		const events = await collect(
			runConversation(failing(), new ConversationEventMapper(), { inactivityTimeoutMs: 5_000 }),
		);

		const last = events[events.length - 1] as Extract<ConversationEvent, { kind: 'error' }>;
		assert.strictEqual(last.kind, 'error');
		assert.match(last.message, /socket exploded/);
	});

	test('inactivity timeout yields error and calls abort', async () => {
		let aborted = false;
		async function* stalls(): AsyncGenerator<Payload> {
			yield { status: 'thinking', conversation_id: 'conv-1' };
			await new Promise(() => {}); // hangs forever
		}

		const events = await collect(
			runConversation(stalls(), new ConversationEventMapper(), {
				inactivityTimeoutMs: 50,
				abort: () => {
					aborted = true;
				},
			}),
		);

		const last = events[events.length - 1] as Extract<ConversationEvent, { kind: 'error' }>;
		assert.strictEqual(last.kind, 'error');
		assert.match(last.message, /No response/);
		assert.ok(aborted, 'abort should have been called');
	});

	test('releases the source iterator on early termination', async () => {
		let returned = false;
		const payloads: Payload[] = [
			{ status: 'complete', message: { content: 'done' } },
			{ status: 'thinking' },
			{ status: 'thinking' },
		];

		await collect(
			runConversation(
				scripted(payloads, () => {
					returned = true;
				}),
				new ConversationEventMapper(),
				{ inactivityTimeoutMs: 5_000 },
			),
		);

		// Iterator release is fire-and-forget; let queued microtasks run
		await new Promise(resolve => setImmediate(resolve));
		assert.ok(returned, 'source iterator should have been returned/closed');
	});
});
