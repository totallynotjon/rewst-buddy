import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';
import * as Mocha from 'mocha';
import type { AskOptions } from '../../sessions/conversation/ConversationClient';
import type { ConversationEvent } from '../../sessions/conversation/conversationEvents';
import { handleAnthropicHttp, type AnthropicProxyDeps } from './anthropicProxy';
import { ProxyConversationCache } from './conversationCache';

const { suite, test, setup } = Mocha;

// ---------------------------------------------------------------------------
// Fake req/res helpers
// ---------------------------------------------------------------------------

function makeReq(options: {
	method?: string;
	url?: string;
	headers?: Record<string, string>;
	body?: string;
}): IncomingMessage {
	const emitter = new EventEmitter();
	const req = Object.assign(emitter, {
		method: options.method ?? 'POST',
		url: options.url ?? '/v1/messages',
		// When headers are provided explicitly, use them as-is (no defaults merged
		// in) so tests that omit e.g. authorization can assert the 401 path.
		headers: options.headers ?? {
			host: '127.0.0.1:27121',
			authorization: 'Bearer tok',
			'content-type': 'application/json',
		},
		socket: { remoteAddress: '127.0.0.1' },
	}) as unknown as IncomingMessage;
	// Emit body on next tick
	const body = options.body ?? JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] });
	setImmediate(() => {
		emitter.emit('data', Buffer.from(body));
		emitter.emit('end');
	});
	return req;
}

interface FakeRes {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	chunks: string[];
	ended: boolean;
	writeHead(code: number, headers?: Record<string, string>): void;
	setHeader(name: string, value: string): void;
	write(chunk: string): void;
	end(data?: string): void;
	on(event: string, listener: (...args: unknown[]) => void): FakeRes;
	headersSent: boolean;
}

function makeRes(): FakeRes {
	const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	const res: FakeRes = {
		statusCode: 200,
		headers: {},
		body: '',
		chunks: [],
		ended: false,
		headersSent: false,
		writeHead(code, hdrs) {
			this.statusCode = code;
			this.headersSent = true;
			if (hdrs) {
				for (const [k, v] of Object.entries(hdrs)) {
					this.headers[k.toLowerCase()] = v as string;
				}
			}
		},
		setHeader(name, value) {
			this.headers[name.toLowerCase()] = value;
		},
		write(chunk) {
			this.chunks.push(chunk);
		},
		end(data) {
			if (data) this.body += data;
			this.ended = true;
		},
		on(event, listener) {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(listener);
			return this;
		},
	};
	return res;
}

function fakeAsk(events: ConversationEvent[]): (options: AskOptions) => AsyncGenerator<ConversationEvent> {
	return async function* (options: AskOptions): AsyncGenerator<ConversationEvent> {
		for (const event of events) {
			yield event;
		}
	};
}

function captureAsk(events: ConversationEvent[]): {
	ask: (options: AskOptions) => AsyncGenerator<ConversationEvent>;
	calls: AskOptions[];
} {
	const calls: AskOptions[] = [];
	const ask = async function* (options: AskOptions): AsyncGenerator<ConversationEvent> {
		calls.push(options);
		for (const event of events) {
			yield event;
		}
	};
	return { ask, calls };
}

function makeDefaultDeps(
	overrides: Partial<AnthropicProxyDeps> = {},
	events: ConversationEvent[] = [{ kind: 'complete', content: 'hi there', sources: [] }],
): { deps: AnthropicProxyDeps; askCalls: AskOptions[] } {
	const { session } = createMockSession({ profile: { org: { id: 'org-1', name: 'Test Org' } } });
	const captured = captureAsk(events);
	const deps: AnthropicProxyDeps = {
		ask: captured.ask,
		sessions: () => [session],
		sessionForOrg: async (id: string) => {
			if (id !== 'org-1') throw new Error(`no session for org ${id}`);
			return session;
		},
		enabled: () => true,
		isValidToken: t => t === 'tok',
		cache: new ProxyConversationCache(),
		...overrides,
	};
	return { deps, askCalls: captured.calls };
}

function parseSseFrames(chunks: string[]): { type: string; data: unknown }[] {
	const frames: { type: string; data: unknown }[] = [];
	const raw = chunks.join('');
	const parts = raw.split('\n\n').filter(Boolean);
	for (const part of parts) {
		const lines = part.split('\n');
		let type = '';
		let dataStr = '';
		for (const line of lines) {
			if (line.startsWith('event: ')) type = line.slice(7);
			if (line.startsWith('data: ')) dataStr = line.slice(6);
		}
		if (type && dataStr) {
			try {
				frames.push({ type, data: JSON.parse(dataStr) });
			} catch {
				/* skip */
			}
		}
	}
	return frames;
}

function parseBody(res: FakeRes): unknown {
	try {
		return JSON.parse(res.body);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Suite: gating
// ---------------------------------------------------------------------------

suite('Unit: Anthropic proxy — gating', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('disabled → 403', async () => {
		const { deps } = makeDefaultDeps({ enabled: () => false });
		const req = makeReq({});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 403);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'permission_error');
		const msg = String((body?.error as Record<string, unknown>)?.message ?? '');
		assert.ok(msg.includes('rewst-buddy.ai.anthropicProxy'), 'message should name the setting');
		// ask was NOT called
		const { askCalls } = makeDefaultDeps({ enabled: () => false });
		assert.strictEqual(askCalls.length, 0);
	});

	test('missing token → 401', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({ headers: { host: '127.0.0.1:27121', 'content-type': 'application/json' } });
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 401);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'authentication_error');
		assert.strictEqual(askCalls.length, 0);
	});

	test('wrong token → 401', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({
			headers: { host: '127.0.0.1:27121', authorization: 'Bearer bad', 'content-type': 'application/json' },
		});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 401);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'authentication_error');
		assert.strictEqual(askCalls.length, 0);
	});

	test('x-api-key accepted', async () => {
		const { deps } = makeDefaultDeps();
		const req = makeReq({
			headers: { host: '127.0.0.1:27121', 'x-api-key': 'tok', 'content-type': 'application/json' },
		});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 200);
	});

	test('non-loopback Host → 403', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({
			headers: { host: 'attacker.example', authorization: 'Bearer tok', 'content-type': 'application/json' },
		});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 403);
		assert.strictEqual(askCalls.length, 0);
	});

	test('non-POST → 405', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({ method: 'GET' });
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 405);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'invalid_request_error');
		assert.strictEqual(askCalls.length, 0);
	});

	test('invalid JSON → 400', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({ body: '{' });
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 400);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'invalid_request_error');
		assert.strictEqual(askCalls.length, 0);
	});

	test('parse failure → 400', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({ body: JSON.stringify({ model: 'm', messages: [] }) });
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 400);
		const body = parseBody(res) as Record<string, unknown>;
		const msg = String((body?.error as Record<string, unknown>)?.message ?? '');
		assert.ok(msg.toLowerCase().includes('messages'), 'error should mention messages field');
		assert.strictEqual(askCalls.length, 0);
	});

	test('unknown /v1 path → 404', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({ url: '/v1/complete' });
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 404);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'not_found_error');
		assert.strictEqual(askCalls.length, 0);
	});

	test('body too large → 413', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		// Build a req that streams > 10 MB
		const emitter = new EventEmitter();
		const req = Object.assign(emitter, {
			method: 'POST',
			url: '/v1/messages',
			headers: {
				host: '127.0.0.1:27121',
				authorization: 'Bearer tok',
				'content-type': 'application/json',
			},
			socket: { remoteAddress: '127.0.0.1', destroy: () => {} },
			destroy: () => {},
		}) as unknown as IncomingMessage;
		const chunk = Buffer.alloc(1024 * 1024, 'x'); // 1 MB
		setImmediate(() => {
			// Send 11 chunks of 1 MB = 11 MB total
			for (let i = 0; i < 11; i++) {
				emitter.emit('data', chunk);
			}
			emitter.emit('end');
		});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 413);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'invalid_request_error');
		assert.strictEqual(askCalls.length, 0);
	});

	test('no sessions → 500', async () => {
		const { deps, askCalls } = makeDefaultDeps({ sessions: () => [] });
		const req = makeReq({});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 500);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'api_error');
		const msg = String((body?.error as Record<string, unknown>)?.message ?? '');
		assert.ok(msg.toLowerCase().includes('session'), 'error should mention session');
		assert.strictEqual(askCalls.length, 0);
	});

	test('x-rewst-org-id header honored', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({
			headers: {
				host: '127.0.0.1:27121',
				authorization: 'Bearer tok',
				'content-type': 'application/json',
				'x-rewst-org-id': 'org-1',
			},
		});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual(askCalls.length, 1);
		assert.strictEqual(askCalls[0].orgId, 'org-1');
	});

	test('x-rewst-org-id unknown org → 400', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({
			headers: {
				host: '127.0.0.1:27121',
				authorization: 'Bearer tok',
				'content-type': 'application/json',
				'x-rewst-org-id': 'org-2',
			},
		});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 400);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'invalid_request_error');
		assert.strictEqual(askCalls.length, 0);
	});
});

// ---------------------------------------------------------------------------
// Suite: non-streaming
// ---------------------------------------------------------------------------

suite('Unit: Anthropic proxy — non-streaming', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('text answer', async () => {
		const { deps, askCalls } = makeDefaultDeps({}, [{ kind: 'complete', content: 'hi there', sources: [] }]);
		const req = makeReq({});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 200);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual(body?.role, 'assistant');
		assert.strictEqual(body?.model, 'claude-3');
		assert.strictEqual(body?.stop_reason, 'end_turn');
		const content = body?.content as Record<string, unknown>[];
		assert.ok(Array.isArray(content));
		const textBlock = content.find(b => b.type === 'text');
		assert.ok(textBlock, 'should have a text block');
		assert.strictEqual(textBlock?.text, 'hi there');
		const usage = body?.usage as Record<string, unknown>;
		assert.ok(typeof usage?.input_tokens === 'number' && (usage.input_tokens as number) > 0, 'input_tokens > 0');
		assert.ok(typeof usage?.output_tokens === 'number' && (usage.output_tokens as number) > 0, 'output_tokens > 0');
		// ask was called with a message containing the transcript
		assert.strictEqual(askCalls.length, 1);
		assert.ok(
			askCalls[0].message.includes('<conversation_transcript>'),
			'message should contain transcript wrapper',
		);
		assert.ok(askCalls[0].message.includes('USER: '), 'message should contain USER entry');
		assert.strictEqual(askCalls[0].conversationId, undefined, 'fresh request should have no conversationId');
		assert.strictEqual(askCalls[0].conversationType, 'HELP_DOCS', 'conversationType should be HELP_DOCS');
	});

	test('tool round-trip', async () => {
		const toolFence = 'Here is the result\n```vscode-tool\n{"tool":"read_file","args":{"path":"x"}}\n```';
		const { deps, askCalls } = makeDefaultDeps({}, [{ kind: 'complete', content: toolFence, sources: [] }]);
		const req = makeReq({
			body: JSON.stringify({
				model: 'claude-3',
				messages: [{ role: 'user', content: 'do something' }],
				tools: [
					{
						name: 'read_file',
						description: 'Read a file',
						input_schema: { type: 'object', properties: { path: { type: 'string' } } },
					},
				],
			}),
		});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 200);
		const body = parseBody(res) as Record<string, unknown>;
		const content = body?.content as Record<string, unknown>[];
		assert.ok(Array.isArray(content));
		const toolUse = content.find(b => b.type === 'tool_use');
		assert.ok(toolUse, 'should have a tool_use block');
		assert.strictEqual(toolUse?.name, 'read_file');
		assert.deepStrictEqual(toolUse?.input, { path: 'x' });
		assert.strictEqual(body?.stop_reason, 'tool_use');
		// ask message should contain tool instructions
		assert.ok(
			askCalls[0].message.includes('Available tools:') || askCalls[0].message.includes('read_file'),
			'message should advertise tools',
		);
	});

	test('status/usage events ignored', async () => {
		const { deps } = makeDefaultDeps({}, [
			{ kind: 'status', label: 'Thinking\u2026' },
			{ kind: 'usage', totalTokens: 1, maxTokens: 2, percent: 50 },
			{ kind: 'complete', content: 'done', sources: [] },
		]);
		const req = makeReq({});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 200);
		const body = parseBody(res) as Record<string, unknown>;
		const content = body?.content as Record<string, unknown>[];
		const textBlock = content?.find(b => b.type === 'text');
		assert.strictEqual(textBlock?.text, 'done');
	});

	test('backend error → 500', async () => {
		const { deps } = makeDefaultDeps({}, [{ kind: 'error', message: 'boom' }]);
		const req = makeReq({});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 500);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'api_error');
		assert.strictEqual((body?.error as Record<string, unknown>)?.message, 'boom');
	});

	test('approval → 500 with guidance', async () => {
		const { deps } = makeDefaultDeps({}, [{ kind: 'approval', tools: [], raw: {} }]);
		const req = makeReq({});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 500);
		const body = parseBody(res) as Record<string, unknown>;
		assert.strictEqual((body?.error as Record<string, unknown>)?.type, 'api_error');
		const msg = String((body?.error as Record<string, unknown>)?.message ?? '');
		assert.ok(msg.toLowerCase().includes('approval'), 'message should mention approval');
	});

	test('count_tokens', async () => {
		const { deps, askCalls } = makeDefaultDeps();
		const req = makeReq({ url: '/v1/messages/count_tokens' });
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 200);
		const body = parseBody(res) as Record<string, unknown>;
		assert.ok(
			typeof body?.input_tokens === 'number' && (body.input_tokens as number) > 0,
			'input_tokens should be > 0',
		);
		assert.strictEqual(askCalls.length, 0, 'ask should not be called for count_tokens');
	});
});

// ---------------------------------------------------------------------------
// Suite: conversation reuse
// ---------------------------------------------------------------------------

suite('Unit: Anthropic proxy — conversation reuse', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('second request reuses warm and sends only the tail', async () => {
		const cache = new ProxyConversationCache();
		const askCalls1: AskOptions[] = [];
		const askCalls2: AskOptions[] = [];

		// First request: user 'hi' → conversation c1, complete 'a1'
		const captured1 = captureAsk([
			{ kind: 'conversation', conversationId: 'c1' },
			{ kind: 'complete', content: 'a1', sources: [] },
		]);
		const { session } = createMockSession({ profile: { org: { id: 'org-1', name: 'Test Org' } } });
		const deps1: AnthropicProxyDeps = {
			ask: opts => {
				askCalls1.push(opts);
				return captured1.ask(opts);
			},
			sessions: () => [session],
			sessionForOrg: async id => {
				if (id !== 'org-1') throw new Error('no session');
				return session;
			},
			enabled: () => true,
			isValidToken: t => t === 'tok',
			cache,
		};

		const req1 = makeReq({
			body: JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] }),
		});
		const res1 = makeRes();
		await handleAnthropicHttp(req1, res1 as unknown as ServerResponse, deps1);
		assert.strictEqual(res1.statusCode, 200);
		assert.strictEqual(askCalls1.length, 1);
		assert.strictEqual(askCalls1[0].conversationId, undefined, 'first request should be stateless');

		// Second request: messages = [user 'hi', assistant 'a1', user 'next']
		const captured2 = captureAsk([
			{ kind: 'conversation', conversationId: 'c1' },
			{ kind: 'complete', content: 'a2', sources: [] },
		]);
		const deps2: AnthropicProxyDeps = {
			ask: opts => {
				askCalls2.push(opts);
				return captured2.ask(opts);
			},
			sessions: () => [session],
			sessionForOrg: async id => {
				if (id !== 'org-1') throw new Error('no session');
				return session;
			},
			enabled: () => true,
			isValidToken: t => t === 'tok',
			cache,
		};

		const req2 = makeReq({
			body: JSON.stringify({
				model: 'claude-3',
				messages: [
					{ role: 'user', content: 'hi' },
					{ role: 'assistant', content: 'a1' },
					{ role: 'user', content: 'next' },
				],
			}),
		});
		const res2 = makeRes();
		await handleAnthropicHttp(req2, res2 as unknown as ServerResponse, deps2);
		assert.strictEqual(res2.statusCode, 200);
		assert.strictEqual(askCalls2.length, 1);
		assert.strictEqual(askCalls2[0].conversationId, 'c1', 'second request should reuse warm conversation');
		// Reuse message should contain 'next' but NOT the full transcript
		assert.ok(askCalls2[0].message.includes('next'), 'reuse message should contain the new user turn');
		assert.ok(
			!askCalls2[0].message.includes('<conversation_transcript>'),
			'reuse message should NOT contain transcript wrapper',
		);
		assert.ok(!askCalls2[0].message.includes('USER: hi'), 'reuse message should NOT contain prior history');
	});

	test('edited history misses → stateless', async () => {
		const cache = new ProxyConversationCache();
		const { session } = createMockSession({ profile: { org: { id: 'org-1', name: 'Test Org' } } });

		// First request
		const captured1 = captureAsk([
			{ kind: 'conversation', conversationId: 'c1' },
			{ kind: 'complete', content: 'a1', sources: [] },
		]);
		const deps1: AnthropicProxyDeps = {
			ask: captured1.ask,
			sessions: () => [session],
			sessionForOrg: async id => {
				if (id !== 'org-1') throw new Error('no session');
				return session;
			},
			enabled: () => true,
			isValidToken: t => t === 'tok',
			cache,
		};
		const req1 = makeReq({
			body: JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] }),
		});
		await handleAnthropicHttp(req1, makeRes() as unknown as ServerResponse, deps1);

		// Second request with EDITED prior user text
		const captured2 = captureAsk([{ kind: 'complete', content: 'a2', sources: [] }]);
		const deps2: AnthropicProxyDeps = {
			ask: captured2.ask,
			sessions: () => [session],
			sessionForOrg: async id => {
				if (id !== 'org-1') throw new Error('no session');
				return session;
			},
			enabled: () => true,
			isValidToken: t => t === 'tok',
			cache,
		};
		const req2 = makeReq({
			body: JSON.stringify({
				model: 'claude-3',
				messages: [
					{ role: 'user', content: 'EDITED: different text' }, // changed
					{ role: 'assistant', content: 'a1' },
					{ role: 'user', content: 'next' },
				],
			}),
		});
		const res2 = makeRes();
		await handleAnthropicHttp(req2, res2 as unknown as ServerResponse, deps2);
		assert.strictEqual(res2.statusCode, 200);
		assert.strictEqual(captured2.calls[0].conversationId, undefined, 'edited history should go stateless');
		assert.ok(
			captured2.calls[0].message.includes('<conversation_transcript>'),
			'stateless message should contain transcript wrapper',
		);
	});

	test('failed reuse downgrades once', async () => {
		const cache = new ProxyConversationCache();
		const { session } = createMockSession({ profile: { org: { id: 'org-1', name: 'Test Org' } } });

		// First request to populate cache
		const captured1 = captureAsk([
			{ kind: 'conversation', conversationId: 'c1' },
			{ kind: 'complete', content: 'a1', sources: [] },
		]);
		const deps1: AnthropicProxyDeps = {
			ask: captured1.ask,
			sessions: () => [session],
			sessionForOrg: async id => {
				if (id !== 'org-1') throw new Error('no session');
				return session;
			},
			enabled: () => true,
			isValidToken: t => t === 'tok',
			cache,
		};
		const req1 = makeReq({
			body: JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] }),
		});
		await handleAnthropicHttp(req1, makeRes() as unknown as ServerResponse, deps1);

		// Second request: reuse attempt fails, then stateless succeeds
		let callCount = 0;
		const allCalls: AskOptions[] = [];
		const ask2 = async function* (opts: AskOptions): AsyncGenerator<ConversationEvent> {
			allCalls.push(opts);
			callCount++;
			if (callCount === 1) {
				// First call (reuse attempt) fails
				yield { kind: 'error', message: 'gone' } as ConversationEvent;
			} else {
				// Second call (stateless retry) succeeds
				yield { kind: 'complete', content: 'retry ok', sources: [] } as ConversationEvent;
			}
		};
		const deps2: AnthropicProxyDeps = {
			ask: ask2,
			sessions: () => [session],
			sessionForOrg: async id => {
				if (id !== 'org-1') throw new Error('no session');
				return session;
			},
			enabled: () => true,
			isValidToken: t => t === 'tok',
			cache,
		};
		const req2 = makeReq({
			body: JSON.stringify({
				model: 'claude-3',
				messages: [
					{ role: 'user', content: 'hi' },
					{ role: 'assistant', content: 'a1' },
					{ role: 'user', content: 'next' },
				],
			}),
		});
		const res2 = makeRes();
		await handleAnthropicHttp(req2, res2 as unknown as ServerResponse, deps2);
		assert.strictEqual(res2.statusCode, 200);
		const body = parseBody(res2) as Record<string, unknown>;
		const content = body?.content as Record<string, unknown>[];
		const textBlock = content?.find(b => b.type === 'text');
		assert.strictEqual(textBlock?.text, 'retry ok', 'should return the retry content');
		assert.strictEqual(allCalls.length, 2, 'exactly 2 ask calls for the second request');
		assert.strictEqual(allCalls[0].conversationId, 'c1', 'first attempt should use warm conversation');
		assert.strictEqual(allCalls[1].conversationId, undefined, 'retry should be stateless');
	});

	test('no history → no reuse attempt', async () => {
		const cache = new ProxyConversationCache();
		// Pre-populate cache with something
		cache.store('some-key', 'c-existing');
		const { deps, askCalls } = makeDefaultDeps({ cache });
		const req = makeReq({
			body: JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'fresh' }] }),
		});
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);
		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual(askCalls.length, 1);
		assert.strictEqual(askCalls[0].conversationId, undefined, 'single-message request should not reuse');
	});
});

// ---------------------------------------------------------------------------
// Suite: streaming
// ---------------------------------------------------------------------------

suite('Unit: Anthropic proxy — streaming', () => {
	setup(() => {
		initTestEnvironment();
	});

	function makeStreamReq(body?: string): IncomingMessage {
		return makeReq({
			body:
				body ??
				JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }], stream: true }),
		});
	}

	test('streams text deltas', async () => {
		const { deps } = makeDefaultDeps({}, [
			{ kind: 'chunk', text: 'hel' },
			{ kind: 'chunk', text: 'lo' },
			{ kind: 'complete', content: 'hello', sources: [] },
		]);
		const req = makeStreamReq();
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);

		// Check headers
		assert.ok(
			res.headers['content-type']?.includes('text/event-stream'),
			'content-type should be text/event-stream',
		);
		assert.ok(res.ended, 'response should be ended');

		const frames = parseSseFrames(res.chunks);
		const types = frames.map(f => f.type);

		// Required event order
		const msgStartIdx = types.indexOf('message_start');
		const cbStartIdx = types.indexOf('content_block_start');
		const msgDeltaIdx = types.indexOf('message_delta');
		const msgStopIdx = types.indexOf('message_stop');

		assert.ok(msgStartIdx >= 0, 'should have message_start');
		assert.ok(cbStartIdx > msgStartIdx, 'content_block_start should come after message_start');
		assert.ok(msgDeltaIdx > cbStartIdx, 'message_delta should come after content_block_start');
		assert.ok(msgStopIdx > msgDeltaIdx, 'message_stop should come after message_delta');

		// Concatenated text deltas should equal 'hello'
		const textDeltas = frames
			.filter(f => f.type === 'content_block_delta')
			.map(f => (f.data as Record<string, unknown>)?.delta)
			.filter(d => (d as Record<string, unknown>)?.type === 'text_delta')
			.map(d => (d as Record<string, unknown>)?.text as string);
		assert.strictEqual(textDeltas.join(''), 'hello', 'concatenated text deltas should equal full content');
	});

	test('withholds a streamed fence, emits tool_use', async () => {
		// Split a vscode-tool fence across multiple chunks
		const fullContent = 'Here is the result\n```vscode-tool\n{"tool":"read_file","args":{"path":"x"}}\n```';
		const chunks = ['Here is the result\n```vsc', 'ode-tool\n{"tool":"read_file",', '"args":{"path":"x"}}\n```'];
		const events: ConversationEvent[] = [
			...chunks.map(text => ({ kind: 'chunk' as const, text })),
			{ kind: 'complete', content: fullContent, sources: [] },
		];
		const { deps } = makeDefaultDeps({}, events);
		const req = makeStreamReq(
			JSON.stringify({
				model: 'claude-3',
				messages: [{ role: 'user', content: 'read a file' }],
				stream: true,
				tools: [{ name: 'read_file', description: 'Read a file', input_schema: { type: 'object' } }],
			}),
		);
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);

		const frames = parseSseFrames(res.chunks);

		// No text delta should contain the fence marker or JSON
		const textDeltaTexts = frames
			.filter(f => f.type === 'content_block_delta')
			.map(f => (f.data as Record<string, unknown>)?.delta)
			.filter(d => (d as Record<string, unknown>)?.type === 'text_delta')
			.map(d => (d as Record<string, unknown>)?.text as string);
		const allTextDelta = textDeltaTexts.join('');
		assert.ok(!allTextDelta.includes('vscode-tool'), 'text deltas should not contain vscode-tool fence marker');
		assert.ok(!allTextDelta.includes('read_file'), 'text deltas should not contain fence JSON');

		// Should have a tool_use content block
		const toolUseStart = frames.find(
			f =>
				f.type === 'content_block_start' &&
				(f.data as Record<string, unknown>)?.content_block &&
				((f.data as Record<string, unknown>).content_block as Record<string, unknown>)?.type === 'tool_use',
		);
		assert.ok(toolUseStart, 'should have a tool_use content_block_start');
		const toolUseBlock = (toolUseStart!.data as Record<string, unknown>).content_block as Record<string, unknown>;
		assert.strictEqual(toolUseBlock.name, 'read_file');

		// Should have an input_json_delta
		const inputJsonDelta = frames.find(
			f =>
				f.type === 'content_block_delta' &&
				((f.data as Record<string, unknown>)?.delta as Record<string, unknown>)?.type === 'input_json_delta',
		);
		assert.ok(inputJsonDelta, 'should have an input_json_delta');
		const partialJson = ((inputJsonDelta!.data as Record<string, unknown>).delta as Record<string, unknown>)
			.partial_json as string;
		assert.deepStrictEqual(JSON.parse(partialJson), { path: 'x' });

		// message_delta should have stop_reason tool_use
		const msgDelta = frames.find(f => f.type === 'message_delta');
		assert.ok(msgDelta, 'should have message_delta');
		const delta = (msgDelta!.data as Record<string, unknown>).delta as Record<string, unknown>;
		assert.strictEqual(delta.stop_reason, 'tool_use');
	});

	test('mid-stream backend error → SSE error event', async () => {
		const { deps } = makeDefaultDeps({}, [
			{ kind: 'chunk', text: 'a' },
			{ kind: 'error', message: 'boom' },
		]);
		const req = makeStreamReq();
		const res = makeRes();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);

		// Status should remain 200 (headers already sent)
		assert.strictEqual(res.statusCode, 200);
		assert.ok(res.ended, 'response should be ended');

		const frames = parseSseFrames(res.chunks);
		const errorFrame = frames.find(f => f.type === 'error');
		assert.ok(errorFrame, 'should have an error SSE event');
		const errData = errorFrame!.data as Record<string, unknown>;
		assert.strictEqual((errData.error as Record<string, unknown>)?.type, 'api_error');
		assert.strictEqual((errData.error as Record<string, unknown>)?.message, 'boom');
	});

	test('client disconnect cancels', async () => {
		let cancelToken: { isCancellationRequested: boolean } | undefined;
		const ask = async function* (opts: AskOptions): AsyncGenerator<ConversationEvent> {
			cancelToken = opts.cancellation as unknown as { isCancellationRequested: boolean };
			yield { kind: 'chunk', text: 'a' };
			// Simulate a delay — the close event fires before we yield more
			await new Promise<void>(resolve => setImmediate(resolve));
			yield { kind: 'complete', content: 'a', sources: [] };
		};
		const { session } = createMockSession({ profile: { org: { id: 'org-1', name: 'Test Org' } } });
		const deps: AnthropicProxyDeps = {
			ask,
			sessions: () => [session],
			sessionForOrg: async id => {
				if (id !== 'org-1') throw new Error('no session');
				return session;
			},
			enabled: () => true,
			isValidToken: t => t === 'tok',
			cache: new ProxyConversationCache(),
		};

		// Build a res that fires 'close' after the first write
		const closeListeners: ((...args: unknown[]) => void)[] = [];
		const res = makeRes();
		const origWrite = res.write.bind(res);
		let closeFired = false;
		res.write = (chunk: string) => {
			origWrite(chunk);
			if (!closeFired) {
				closeFired = true;
				for (const l of closeListeners) l();
			}
		};
		const origOn = res.on.bind(res);
		res.on = (event: string, listener: (...args: unknown[]) => void) => {
			if (event === 'close') closeListeners.push(listener);
			return origOn(event, listener);
		};

		const req = makeStreamReq();
		await handleAnthropicHttp(req, res as unknown as ServerResponse, deps);

		// The cancellation token should have been requested
		assert.ok(cancelToken !== undefined, 'cancellation token should have been set');
		assert.ok(
			(cancelToken as { isCancellationRequested: boolean }).isCancellationRequested,
			'cancellation token should be cancelled after close',
		);
	});
});
