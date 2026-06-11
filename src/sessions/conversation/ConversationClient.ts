import { log } from '@utils';
import { createClient } from 'graphql-ws';
import vscode from 'vscode';
import WebSocket from 'ws';
import { getSubscriptionsUrl, RegionConfig } from '../RegionConfig';
import type Session from '../Session';
import { ConversationEventMapper, type ConversationEvent, type RawConversationPayload } from './conversationEvents';

const DEFAULT_INACTIVITY_TIMEOUT_MS = 120_000;

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
	cancellation?: vscode.CancellationToken;
	inactivityTimeoutMs?: number;
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
	const cancelListener = options.cancellation?.onCancellationRequested(dispose);

	const variables = {
		message: options.message,
		orgId,
		conversationId: options.conversationId ?? null,
		conversationType: options.conversationType ?? 'HELP_DOCS',
		// Without metadata.orgId the server registers the request and then
		// silently never processes it (docs/dev/rewst-ai-api.md).
		metadata: { orgId },
		resumeRequestId: options.resumeRequestId ?? null,
	};

	log.debug('askRewstAi: starting subscription', {
		orgId,
		conversationId: variables.conversationId,
		conversationType: variables.conversationType,
		resumeRequestId: variables.resumeRequestId,
	});

	try {
		if (options.cancellation?.isCancellationRequested) return;
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
