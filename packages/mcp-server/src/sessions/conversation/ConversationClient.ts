import { log, type Disposable } from '../../host';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { getSubscriptionsUrl, type RegionConfig } from '../RegionConfig';
import type Session from '../Session';
import { ConversationEventMapper, type ConversationEvent, type RawConversationPayload } from './conversationEvents';
import { clampConversationMessage } from './messageBudget';

const DEFAULT_INACTIVITY_TIMEOUT_MS = 240_000;

// Live-verified document (docs/dev/rewst-ai-api.md). $resumeRequestId is the
// web app's reattach/continue handle — passed to resume a paused request (e.g.
// after an approval_required); null for a fresh turn.
const CONVERSATION_MESSAGE_SUBSCRIPTION = `
	subscription ($message: String!, $orgId: ID!, $conversationId: ID, $conversationType: String, $metadata: JSON, $resumeRequestId: ID) {
		conversationMessage(
			message: $message
			orgId: $orgId
			conversationId: $conversationId
			conversationType: $conversationType
			metadata: $metadata
			resumeRequestId: $resumeRequestId
		) {
			status
			error
			conversation_id
			metadata
			message {
				id
				content
				role
			}
		}
	}`;

export interface AskOptions {
	session: Session;
	orgId: string;
	message: string;
	conversationId?: string;
	conversationType?: string;
	/** Reattach to a paused request (e.g. to continue after approval_required). */
	resumeRequestId?: string;
	cancellation?: CancellationToken | AbortSignal;
	inactivityTimeoutMs?: number;
}

/** Portable cancellation shape accepted by hosts and embedding applications. */
export interface CancellationToken {
	isCancellationRequested?: boolean;
	onCancellationRequested?: (listener: () => unknown) => Disposable;
}

interface RunOptions {
	inactivityTimeoutMs: number;
	/** Tears down the underlying transport when the loop gives up waiting. */
	abort?: () => void;
}

const TIMED_OUT = Symbol('timed-out');

async function nextWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<typeof TIMED_OUT>(resolve => {
				timer = setTimeout(() => resolve(TIMED_OUT), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Core subscription loop, separated from transport wiring so it can be unit
 * tested with a scripted iterable. Terminates after the first complete/error
 * event; the inactivity timeout resets on every received payload.
 */
export async function* runConversation(
	payloads: AsyncIterable<RawConversationPayload | null | undefined>,
	mapper: ConversationEventMapper,
	options: RunOptions,
): AsyncGenerator<ConversationEvent> {
	const iterator = payloads[Symbol.asyncIterator]();
	try {
		for (;;) {
			let next: IteratorResult<RawConversationPayload | null | undefined> | typeof TIMED_OUT;
			try {
				const step = iterator.next();
				next = await nextWithTimeout(step, options.inactivityTimeoutMs);
				if (next === TIMED_OUT) {
					// The dangling next() settles (or rejects) once abort tears
					// down the transport; swallow it to avoid unhandled rejections.
					step.catch(() => {});
					options.abort?.();
					yield {
						kind: 'error',
						message: `No response from the Rewst AI assistant for ${Math.round(options.inactivityTimeoutMs / 1000)}s.`,
					};
					return;
				}
			} catch (error) {
				yield { kind: 'error', message: error instanceof Error ? error.message : String(error) };
				return;
			}

			if (next.done) return;

			for (const event of mapper.map(next.value)) {
				yield event;
				if (event.kind === 'complete' || event.kind === 'error') return;
			}
		}
	} finally {
		// Fire-and-forget: a source stalled mid-await would never settle return(),
		// and the transport teardown (abort/dispose) is what actually frees it.
		Promise.resolve(iterator.return?.(undefined)).catch(() => {});
	}
}

// Secrets hold whatever cookie string validated at session creation — either a
// full "name=value" cookie or a bare token.
function toCookieHeader(stored: string, region: RegionConfig): string {
	return stored.includes('=') ? stored : `${region.cookieName}=${stored}`;
}

function isCancelled(token: CancellationToken | AbortSignal | undefined): boolean {
	return !!token && ('aborted' in token ? token.aborted : token.isCancellationRequested === true);
}

function onCancelled(token: CancellationToken | AbortSignal | undefined, listener: () => void): Disposable | undefined {
	if (!token) return undefined;
	if ('addEventListener' in token) {
		token.addEventListener('abort', listener, { once: true });
		return { dispose: () => token.removeEventListener('abort', listener) };
	}
	return token.onCancellationRequested?.(listener);
}

interface SubscriptionResult {
	data?: { conversationMessage?: RawConversationPayload | null } | null;
	errors?: readonly { message: string }[];
}

async function* payloadsOf(
	results: AsyncIterable<SubscriptionResult>,
): AsyncIterable<RawConversationPayload | null | undefined> {
	for await (const result of results) {
		if (result.errors?.length) {
			throw new Error(result.errors.map(e => e.message).join('; '));
		}
		yield result.data?.conversationMessage;
	}
}

export interface ConversationVariables extends Record<string, unknown> {
	message: string;
	orgId: string;
	conversationId: string | null;
	conversationType: string;
	metadata: { orgId: string };
	resumeRequestId: string | null;
}

/** A role-aware message written into a disposable conversation before asking. */
export interface SeedChunk {
	role: 'USER' | 'ASSISTANT';
	content: string;
}

/**
 * Subscription variables for one turn. Separated from the transport so the wire's
 * last-defense clamp is testable: the backend rejects an over-long message
 * outright, failing the whole turn, and callers budget their own pieces
 * (utils/messageBudget.ts), so no path may reach the socket unclamped (#189).
 */
export function conversationVariables(options: AskOptions, orgId: string): ConversationVariables {
	const clamped = clampConversationMessage(options.message);
	if (clamped.trimmed > 0) {
		log.info(`askRewstAi: message clamped to the backend limit (dropped ${clamped.trimmed} chars)`);
	}
	return {
		message: clamped.message,
		orgId,
		conversationId: options.conversationId ?? null,
		conversationType: options.conversationType ?? 'HELP_DOCS',
		// Without metadata.orgId the server registers the request and then
		// silently never processes it (docs/dev/rewst-ai-api.md).
		metadata: { orgId },
		resumeRequestId: options.resumeRequestId ?? null,
	};
}

/**
 * Ask RoboRewsty a question over the conversationMessage subscription.
 * Yields typed events until complete/error; cancellation tears down the socket.
 */
export async function* askRewstAi(options: AskOptions): AsyncGenerator<ConversationEvent> {
	const { session, orgId } = options;
	// Secrets are keyed by the session's primary org — correct even when the
	// question targets a managed sub-org.
	const cookie = toCookieHeader(await session.getCookies(), session.profile.region);
	const url = getSubscriptionsUrl(session.profile.region);

	class CookieWebSocket extends WebSocket {
		constructor(address: string | URL, protocols?: string | string[]) {
			super(address, protocols, { headers: { cookie } });
		}
	}

	const client = createClient({
		url,
		webSocketImpl: CookieWebSocket,
		retryAttempts: 0,
		lazy: true,
		on: {
			connected: () => log.debug('askRewstAi: ws connected', { url }),
			closed: () => log.debug('askRewstAi: ws closed'),
			error: err => log.debug('askRewstAi: ws error', err),
		},
	});

	const dispose = () => {
		Promise.resolve(client.dispose()).catch(() => {});
	};
	const cancelListener = onCancelled(options.cancellation, dispose);

	const variables = conversationVariables(options, orgId);

	log.debug('askRewstAi: starting subscription', {
		orgId,
		conversationId: variables.conversationId,
		conversationType: variables.conversationType,
		resumeRequestId: variables.resumeRequestId,
	});

	try {
		if (isCancelled(options.cancellation)) return;
		const results = client.iterate<SubscriptionResult['data']>({
			query: CONVERSATION_MESSAGE_SUBSCRIPTION,
			variables,
		});
		yield* runConversation(payloadsOf(results), new ConversationEventMapper(), {
			inactivityTimeoutMs: options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS,
			abort: dispose,
		});
	} finally {
		cancelListener?.dispose();
		dispose();
	}
}

const CREATE_CONVERSATION_MUTATION = `mutation RewstBuddyCreateConversation($conversation: ConversationInput!) {
	createConversation(conversation: $conversation) { id }
}`;
const CREATE_CONVERSATION_MESSAGE_MUTATION = `mutation RewstBuddyCreateConversationMessage($message: ConversationMessageInput!) {
	createConversationMessage(message: $message) { id }
}`;
const DELETE_CONVERSATION_MUTATION = `mutation RewstBuddyDeleteConversation($id: ID!) {
	deleteConversation(id: $id)
}`;

function graphqlError(result: { errors?: unknown }): string | undefined {
	if (!Array.isArray(result.errors) || result.errors.length === 0) return undefined;
	return result.errors
		.map(error =>
			error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error),
		)
		.join('; ');
}

/**
 * Create a single-use AI conversation and seed the visible chat history. The
 * server only incorporates mutation-written messages when the first
 * conversation subscription ask is made, so callers must create one per ask.
 */
export async function seedConversation(
	session: Session,
	orgId: string,
	conversationType: string,
	chunks: readonly SeedChunk[],
): Promise<string> {
	const created = await session.rawGraphql(CREATE_CONVERSATION_MUTATION, {
		conversation: { orgId, title: 'rewst-buddy', type: conversationType },
	});
	const createError = graphqlError(created);
	if (createError) throw new Error(`Failed to create AI conversation: ${createError}`);
	const conversationId = (created.data as { createConversation?: { id?: unknown } } | undefined)?.createConversation
		?.id;
	if (typeof conversationId !== 'string' || conversationId.length === 0)
		throw new Error('Failed to create AI conversation: the API returned no conversation id.');

	try {
		for (const chunk of chunks) {
			if (!chunk || (chunk.role !== 'USER' && chunk.role !== 'ASSISTANT'))
				throw new Error('AI conversation seed contains an unsupported message role.');
			if (typeof chunk.content !== 'string')
				throw new Error('AI conversation seed contains non-string message content.');
			if (chunk.content.length === 0) continue;
			const result = await session.rawGraphql(CREATE_CONVERSATION_MESSAGE_MUTATION, {
				message: { conversationId, role: chunk.role, content: chunk.content },
			});
			const error = graphqlError(result);
			if (error) throw new Error(`Failed to seed AI conversation: ${error}`);
		}
		return conversationId;
	} catch (error) {
		// Best-effort cleanup prevents a partial seed from becoming an orphaned
		// backend conversation. Preserve the original failure for the caller.
		await session.rawGraphql(DELETE_CONVERSATION_MUTATION, { id: conversationId }).catch(() => undefined);
		throw error;
	}
}
