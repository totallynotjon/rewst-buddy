/**
 * Anthropic Messages API proxy handler.
 * Routes POST /v1/messages and POST /v1/messages/count_tokens to the Rewst AI
 * assistant, translating between the Anthropic wire format and the internal
 * conversation transport.
 */
import { extPrefix } from '@global';
import { SessionManager } from '@sessions';
import { log } from '@utils';
import { IncomingMessage, ServerResponse } from 'http';
import vscode from 'vscode';
import { parseBearerToken } from '../../mcp/protocol';
import { isValidMcpToken } from '../../mcp/runtime';
import { askRewstAi, type AskOptions } from '../../sessions/conversation/ConversationClient';
import type { ConversationEvent } from '../../sessions/conversation/conversationEvents';
import type Session from '../../sessions/Session';
import { ChunkGate } from '../../ui/chat/tools/chunkGate';
import { evaluateRequestGuard, requestGuardInputFromRequest } from '../requestGuard';
import { ProxyConversationCache, transcriptKey } from './conversationCache';
import { sseEvent } from './sse';
import {
	buildBackendMessage,
	buildReuseTurnMessage,
	entryLine,
	estimateTokens,
	mapCompletion,
	newMessageId,
	parseAnthropicRequest,
	predictedAssistantLine,
	toToolSpecs,
	type AnthropicRequest,
	type Completion,
} from './wire';

// ---------------------------------------------------------------------------
// Module-level singleton cache
// ---------------------------------------------------------------------------

export const proxyConversationCache = new ProxyConversationCache();

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AnthropicProxyDeps {
	ask(options: AskOptions): AsyncGenerator<ConversationEvent>;
	sessions(): Session[];
	sessionForOrg(orgId: string): Promise<Session>;
	/** Reads rewst-buddy.ai.anthropicProxy */
	enabled(): boolean;
	/** Wraps isValidMcpToken */
	isValidToken(presented: string | undefined): boolean;
	/** Conversation-reuse cache */
	cache: ProxyConversationCache;
}

export function isAnthropicProxyEnabled(): boolean {
	return vscode.workspace.getConfiguration(`${extPrefix}.ai`).get('anthropicProxy', false);
}

function readAiConversationType(): string {
	return vscode.workspace.getConfiguration(`${extPrefix}.ai`).get('conversationType', 'HELP_DOCS');
}

export const defaultAnthropicProxyDeps: AnthropicProxyDeps = {
	ask: askRewstAi,
	sessions: () => SessionManager.getActiveSessions(),
	sessionForOrg: (orgId: string) => SessionManager.getSessionForOrg(orgId),
	enabled: isAnthropicProxyEnabled,
	isValidToken: isValidMcpToken,
	cache: proxyConversationCache,
};

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

type AnthropicErrorType =
	| 'invalid_request_error'
	| 'authentication_error'
	| 'permission_error'
	| 'not_found_error'
	| 'api_error';

function writeError(res: ServerResponse, status: number, type: AnthropicErrorType, message: string): void {
	const body = JSON.stringify({ type: 'error', error: { type, message } });
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(body);
}

function writeErrorIfHeadersNotSent(
	res: ServerResponse,
	status: number,
	type: AnthropicErrorType,
	message: string,
): void {
	if (res.headersSent) {
		res.write(sseEvent('error', { type: 'error', error: { type, message } }));
		res.end();
	} else {
		writeError(res, status, type, message);
	}
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

export async function handleAnthropicHttp(
	req: IncomingMessage,
	res: ServerResponse,
	deps: AnthropicProxyDeps = defaultAnthropicProxyDeps,
): Promise<void> {
	// 1. Route on path
	const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '');
	const isMessages = path === '/v1/messages';
	const isCountTokens = path === '/v1/messages/count_tokens';
	if (!isMessages && !isCountTokens) {
		writeError(res, 404, 'not_found_error', `Unknown path: ${path}`);
		return;
	}

	// 2. Setting gate
	if (!deps.enabled()) {
		writeError(
			res,
			403,
			'permission_error',
			`The Anthropic proxy is disabled. Enable it with the rewst-buddy.ai.anthropicProxy setting.`,
		);
		return;
	}

	// 3. Loopback guard
	const guard = evaluateRequestGuard(requestGuardInputFromRequest(req));
	if (!guard.allowed) {
		writeError(res, 403, 'permission_error', 'Request rejected: not a local request');
		return;
	}

	// 4. Token auth — accept Authorization: Bearer <t> OR x-api-key header
	const bearerToken = parseBearerToken(
		typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
	);
	const apiKeyToken = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined;
	const presentedToken = bearerToken ?? apiKeyToken;
	if (!deps.isValidToken(presentedToken)) {
		writeError(
			res,
			401,
			'authentication_error',
			'Invalid or missing token. Use the Rewst Buddy local MCP token in Authorization: Bearer or x-api-key.',
		);
		return;
	}

	// 5. Method
	if (req.method !== 'POST') {
		writeError(res, 405, 'invalid_request_error', 'Method not allowed. Use POST.');
		return;
	}

	// 6. Read body with 10 MB cap
	let rawBody: string;
	try {
		rawBody = await readBody(req, MAX_BODY_BYTES);
	} catch (e) {
		if (e instanceof BodyTooLargeError) {
			writeError(res, 413, 'invalid_request_error', 'Request body too large (max 10 MB)');
			return;
		}
		writeError(res, 500, 'api_error', 'Failed to read request body');
		return;
	}

	// 7. Parse JSON + Anthropic request
	let parsed: AnthropicRequest;
	try {
		const jsonBody: unknown = JSON.parse(rawBody);
		const result = parseAnthropicRequest(jsonBody);
		if ('error' in result) {
			writeError(res, 400, 'invalid_request_error', result.error);
			return;
		}
		parsed = result;
	} catch {
		writeError(res, 400, 'invalid_request_error', 'Invalid JSON in request body');
		return;
	}

	// 8. Session resolution
	let session: Session;
	let orgId: string;
	const orgHeader = typeof req.headers['x-rewst-org-id'] === 'string' ? req.headers['x-rewst-org-id'] : undefined;
	if (orgHeader) {
		try {
			session = await deps.sessionForOrg(orgHeader);
			orgId = orgHeader;
		} catch {
			writeError(res, 400, 'invalid_request_error', `No active session for org ${orgHeader}`);
			return;
		}
	} else {
		const sessions = deps.sessions();
		if (sessions.length === 0) {
			writeError(res, 500, 'api_error', 'No active Rewst session. Sign in with Rewst Buddy first.');
			return;
		}
		session = sessions[0];
		orgId = session.profile.org.id;
	}

	// 9. count_tokens route
	if (isCountTokens) {
		const message = buildBackendMessage(parsed);
		const body = JSON.stringify({ input_tokens: estimateTokens(message) });
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(body);
		return;
	}

	// 10. /v1/messages — determine reuse vs stateless
	const entryLines = parsed.messages.map(m => entryLine(m.role, m.parts));

	// Find tailStart: index of first entry in trailing contiguous user-role run
	let tailStart = parsed.messages.length;
	for (let i = parsed.messages.length - 1; i >= 0; i--) {
		if (parsed.messages[i].role === 'user') {
			tailStart = i;
		} else {
			break;
		}
	}

	const specs = toToolSpecs(parsed.tools);
	const toolNames = new Set(parsed.tools.map(t => t.name));

	let message: string;
	let conversationId: string | undefined;
	let warmId: string | undefined;

	if (tailStart > 0) {
		// There is prior history — check cache
		const prefixKey = transcriptKey(orgId, parsed.system, entryLines.slice(0, tailStart));
		warmId = deps.cache.lookup(prefixKey);
	}

	if (warmId !== undefined) {
		// Reuse mode
		message = buildReuseTurnMessage(parsed.messages.slice(tailStart), specs);
		conversationId = warmId;
	} else {
		// Stateless mode
		message = buildBackendMessage(parsed);
		conversationId = undefined;
	}

	// Cancellation on client disconnect
	const cts = new vscode.CancellationTokenSource();
	res.on('close', () => cts.cancel());

	const askOptions: AskOptions = {
		session,
		orgId,
		message,
		conversationId,
		conversationType: readAiConversationType(),
		cancellation: cts.token,
	};

	if (parsed.stream) {
		await handleStreaming(
			req,
			res,
			deps,
			parsed,
			askOptions,
			entryLines,
			toolNames,
			specs,
			warmId,
			session,
			orgId,
			cts,
		);
	} else {
		await handleNonStreaming(
			res,
			deps,
			parsed,
			askOptions,
			entryLines,
			toolNames,
			specs,
			warmId,
			session,
			orgId,
			cts,
		);
	}
}

// ---------------------------------------------------------------------------
// Non-streaming handler
// ---------------------------------------------------------------------------

async function handleNonStreaming(
	res: ServerResponse,
	deps: AnthropicProxyDeps,
	parsed: AnthropicRequest,
	askOptions: AskOptions,
	entryLines: string[],
	toolNames: Set<string>,
	specs: ReturnType<typeof toToolSpecs>,
	warmId: string | undefined,
	session: Session,
	orgId: string,
	cts: vscode.CancellationTokenSource,
): Promise<void> {
	const result = await runAsk(
		deps,
		askOptions,
		warmId,
		session,
		parsed,
		entryLines,
		specs,
		toolNames,
		orgId,
		false,
		res,
	);
	if (!result) return; // cancelled or already responded

	const { completion, completeContent, usedConversationId } = result;

	// Cache write (non-blocking)
	if (usedConversationId) {
		const nextKey = transcriptKey(orgId, parsed.system, [...entryLines, predictedAssistantLine(completion)]);
		const evicted = deps.cache.store(nextKey, usedConversationId);
		for (const evictedId of evicted) {
			void session.sdk?.deleteConversation({ id: evictedId })?.catch(() => {});
		}
	}

	// Build response
	const content: unknown[] = [];
	if (completion.text) content.push({ type: 'text', text: completion.text });
	for (const tu of completion.toolUses) content.push(tu);

	const responseBody = JSON.stringify({
		id: newMessageId(),
		type: 'message',
		role: 'assistant',
		model: parsed.model,
		content,
		stop_reason: completion.stopReason,
		stop_sequence: null,
		usage: {
			input_tokens: estimateTokens(askOptions.message),
			output_tokens: estimateTokens(completeContent),
		},
	});
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(responseBody);
	cts.dispose();
}

// ---------------------------------------------------------------------------
// Streaming handler
// ---------------------------------------------------------------------------

async function handleStreaming(
	_req: IncomingMessage,
	res: ServerResponse,
	deps: AnthropicProxyDeps,
	parsed: AnthropicRequest,
	askOptions: AskOptions,
	entryLines: string[],
	toolNames: Set<string>,
	specs: ReturnType<typeof toToolSpecs>,
	warmId: string | undefined,
	session: Session,
	orgId: string,
	cts: vscode.CancellationTokenSource,
): Promise<void> {
	// Emit message_start once (before any retry)
	const msgId = newMessageId();
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
	});
	res.write(
		sseEvent('message_start', {
			type: 'message_start',
			message: {
				id: msgId,
				type: 'message',
				role: 'assistant',
				model: parsed.model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: estimateTokens(askOptions.message), output_tokens: 0 },
			},
		}),
	);

	const result = await runAsk(
		deps,
		askOptions,
		warmId,
		session,
		parsed,
		entryLines,
		specs,
		toolNames,
		orgId,
		true,
		res,
	);
	if (!result) {
		res.end();
		cts.dispose();
		return;
	}

	const { completion, completeContent, usedConversationId, gate } = result;

	// Cache write (non-blocking)
	if (usedConversationId) {
		const nextKey = transcriptKey(orgId, parsed.system, [...entryLines, predictedAssistantLine(completion)]);
		const evicted = deps.cache.store(nextKey, usedConversationId);
		for (const evictedId of evicted) {
			void session.sdk?.deleteConversation({ id: evictedId })?.catch(() => {});
		}
	}

	// Emit tool_use blocks (after text block)
	let blockIndex = gate && (gate.streamedAny || gate.blocked) ? 1 : 0;

	for (const tu of completion.toolUses) {
		res.write(
			sseEvent('content_block_start', {
				type: 'content_block_start',
				index: blockIndex,
				content_block: { type: 'tool_use', id: tu.id, name: tu.name, input: {} },
			}),
		);
		res.write(
			sseEvent('content_block_delta', {
				type: 'content_block_delta',
				index: blockIndex,
				delta: { type: 'input_json_delta', partial_json: JSON.stringify(tu.input) },
			}),
		);
		res.write(sseEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex }));
		blockIndex++;
	}

	res.write(
		sseEvent('message_delta', {
			type: 'message_delta',
			delta: { stop_reason: completion.stopReason, stop_sequence: null },
			usage: { output_tokens: estimateTokens(completeContent) },
		}),
	);
	res.write(sseEvent('message_stop', { type: 'message_stop' }));
	res.end();
	cts.dispose();
}

// ---------------------------------------------------------------------------
// Core ask loop (shared between streaming and non-streaming)
// ---------------------------------------------------------------------------

interface AskResult {
	completion: Completion;
	completeContent: string;
	usedConversationId: string | undefined;
	gate?: ChunkGate;
}

/**
 * Runs the ask loop, handling reuse→stateless downgrade on error.
 * Returns null when the response has already been terminated (cancelled or
 * terminal error written to the stream).
 */
async function runAsk(
	deps: AnthropicProxyDeps,
	askOptions: AskOptions,
	warmId: string | undefined,
	session: Session,
	parsed: AnthropicRequest,
	entryLines: string[],
	specs: ReturnType<typeof toToolSpecs>,
	toolNames: Set<string>,
	orgId: string,
	streaming: boolean,
	res: ServerResponse,
): Promise<AskResult | null> {
	const isReuse = warmId !== undefined;
	let usedConversationId: string | undefined;
	let completeContent = '';
	let gate: ChunkGate | undefined;
	let textBlockOpen = false;
	let deltaEmitted = false;

	if (streaming) gate = new ChunkGate();

	const emitTextDelta = (text: string) => {
		if (!text) return;
		if (!textBlockOpen) {
			res.write(
				sseEvent('content_block_start', {
					type: 'content_block_start',
					index: 0,
					content_block: { type: 'text', text: '' },
				}),
			);
			textBlockOpen = true;
		}
		res.write(
			sseEvent('content_block_delta', {
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'text_delta', text },
			}),
		);
		deltaEmitted = true;
	};

	const closeTextBlock = () => {
		if (textBlockOpen) {
			res.write(sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }));
			textBlockOpen = false;
		}
	};

	for await (const event of deps.ask(askOptions)) {
		switch (event.kind) {
			case 'registered':
			case 'status':
			case 'usage':
				break;

			case 'conversation':
				usedConversationId = event.conversationId;
				break;

			case 'chunk':
				if (streaming && gate) {
					const released = gate.push(event.text);
					if (released) emitTextDelta(released);
				}
				break;

			case 'approval': {
				const msg =
					'The Rewst AI assistant paused for a Rewst-side tool approval, which the Anthropic proxy cannot grant. Rephrase the request to avoid Rewst-side agent actions.';
				if (isReuse) deps.cache.forget(warmId!);
				writeErrorIfHeadersNotSent(res, 500, 'api_error', msg);
				return null;
			}

			case 'error': {
				// Reuse mode: downgrade to stateless if nothing written yet
				if (isReuse && !deltaEmitted && !res.headersSent) {
					log.debug('anthropicProxy: reuse failed, downgrading to stateless', { warmId });
					deps.cache.forget(warmId!);
					void session.sdk?.deleteConversation({ id: warmId! })?.catch(() => {});
					// Rebuild as stateless
					const statelessMessage = buildBackendMessage(parsed);
					const statelessOptions: AskOptions = {
						...askOptions,
						message: statelessMessage,
						conversationId: undefined,
					};
					return runAsk(
						deps,
						statelessOptions,
						undefined,
						session,
						parsed,
						entryLines,
						specs,
						toolNames,
						orgId,
						streaming,
						res,
					);
				}
				writeErrorIfHeadersNotSent(res, 500, 'api_error', event.message);
				return null;
			}

			case 'complete': {
				completeContent = event.content;
				const completion = mapCompletion(completeContent, toolNames);

				if (streaming && gate) {
					// Flush remainder per spec formula
					const remainder = gate.streamedAny || gate.blocked ? gate.flush() : completion.text;
					if (remainder) emitTextDelta(remainder);
					closeTextBlock();
				}

				return { completion, completeContent, usedConversationId, gate };
			}
		}
	}

	// Stream ended without complete/error (cancelled)
	return null;
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		let rejected = false;

		req.on('data', (chunk: Buffer) => {
			if (rejected) return;
			total += chunk.length;
			if (total > maxBytes) {
				rejected = true;
				(req as IncomingMessage & { destroy?: () => void }).destroy?.();
				reject(new BodyTooLargeError());
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8'));
		});
		req.on('error', reject);
	});
}
