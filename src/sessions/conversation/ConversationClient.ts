import { invoke } from '../../backend/operations';
import { log } from '../../../packages/mcp-server/src/host';
import { clampConversationMessage } from '../../../packages/mcp-server/src/sessions/conversation/messageBudget';
import type Session from '../Session';
import type { ConversationEvent } from './conversationEvents';

export interface CancellationToken {
	isCancellationRequested?: boolean;
	onCancellationRequested?: (listener: () => unknown) => { dispose(): void };
}

export interface AskOptions {
	session: Session;
	orgId: string;
	message: string;
	conversationId?: string;
	conversationType?: string;
	resumeRequestId?: string;
	cancellation?: CancellationToken | AbortSignal;
	inactivityTimeoutMs?: number;
}

export interface SeedChunk {
	role: 'USER' | 'ASSISTANT';
	content: string;
}

export interface ConversationVariables extends Record<string, unknown> {
	message: string;
	orgId: string;
	conversationId: string | null;
	conversationType: string;
	metadata: { orgId: string };
	resumeRequestId: string | null;
}

/** Build the portable subscription payload used by the trusted runtime. */
export function conversationVariables(options: AskOptions, orgId: string): ConversationVariables {
	const clamped = clampConversationMessage(options.message);
	if (clamped.trimmed > 0)
		log.info(`askRewstAi: message clamped to the backend limit (dropped ${clamped.trimmed} chars)`);
	return {
		message: clamped.message,
		orgId,
		conversationId: options.conversationId ?? null,
		conversationType: options.conversationType ?? 'HELP_DOCS',
		metadata: { orgId },
		resumeRequestId: options.resumeRequestId ?? null,
	};
}

/** Create a disposable backend conversation and seed its visible chat history. */
export async function seedConversation(
	session: Session,
	orgId: string,
	conversationType: string,
	chunks: readonly SeedChunk[],
): Promise<string> {
	return invoke<string>('conversation.seed', {
		sessionId: session.sessionId ?? session.profile.user.id,
		orgId,
		conversationType,
		chunks,
	});
}

let streamCounter = 0;
function nextStreamId(): string {
	streamCounter = (streamCounter + 1) % Number.MAX_SAFE_INTEGER;
	return `editor-${Date.now().toString(36)}-${streamCounter.toString(36)}`;
}

function cancelled(token: AskOptions['cancellation']): boolean {
	return !!token && ('aborted' in token ? token.aborted === true : token.isCancellationRequested === true);
}

function isAbortSignal(token: AskOptions['cancellation']): token is AbortSignal {
	return !!token && typeof (token as AbortSignal).addEventListener === 'function' && 'aborted' in token;
}

function subscribeCancellation(token: AskOptions['cancellation'], abort: () => void): { dispose(): void } | undefined {
	if (!token) return undefined;
	if (isAbortSignal(token)) {
		token.addEventListener('abort', abort, { once: true });
		return { dispose: () => token.removeEventListener('abort', abort) };
	}
	return token.onCancellationRequested?.(abort);
}

/** Sends one conversation through the trusted runtime and yields its events. */
export async function* askRewstAi(options: AskOptions): AsyncGenerator<ConversationEvent> {
	if (cancelled(options.cancellation)) return;
	const streamId = nextStreamId();
	const queue: ConversationEvent[] = [];
	let wake: (() => void) | undefined;
	let done = false;
	let cancelledByUser = false;
	let failure: unknown;
	const push = (raw: unknown) => {
		if (!raw || typeof raw !== 'object') return;
		const payload = raw as { streamId?: unknown; event?: unknown };
		if (payload.streamId !== streamId || !payload.event || typeof payload.event !== 'object') return;
		queue.push(payload.event as ConversationEvent);
		wake?.();
		wake = undefined;
	};
	// Own the operation signal so an early consumer return can stop this turn
	// without cancelling the caller's token, which may be reused for a retry.
	const adapter = new AbortController();
	const cancelListener = subscribeCancellation(options.cancellation, () => {
		cancelledByUser = true;
		adapter.abort();
		done = true;
		wake?.();
		wake = undefined;
	});
	const operation = invoke<{ streamId: string }>(
		'conversation.ask',
		{
			sessionId: options.session.sessionId ?? options.session.profile.user.id,
			orgId: options.orgId,
			message: options.message,
			streamId,
			...(options.conversationId === undefined ? {} : { conversationId: options.conversationId }),
			...(options.conversationType === undefined ? {} : { conversationType: options.conversationType }),
			...(options.resumeRequestId === undefined ? {} : { resumeRequestId: options.resumeRequestId }),
		},
		{ onEvent: push, signal: adapter.signal },
	);
	void operation
		.catch(error => {
			failure = error;
		})
		.finally(() => {
			done = true;
			wake?.();
			wake = undefined;
		});
	try {
		while (!done || queue.length > 0) {
			if (queue.length === 0)
				await new Promise<void>(resolve => {
					wake = resolve;
				});
			while (queue.length > 0) yield queue.shift()!;
		}
		if (!cancelledByUser && failure) throw failure;
	} finally {
		cancelListener?.dispose();
		adapter.abort();
	}
}

interface RunOptions {
	inactivityTimeoutMs: number;
	abort?: () => void;
}

const TIMED_OUT = Symbol('timed-out');

async function nextWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<typeof TIMED_OUT>(resolve => {
				timer = setTimeout(() => resolve(TIMED_OUT), ms);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** Pure progress loop retained for callers that already have mapped payloads. */
export async function* runConversation(
	payloads: AsyncIterable<import('./conversationEvents').RawConversationPayload | null | undefined>,
	mapper: import('./conversationEvents').ConversationEventMapper,
	options: RunOptions,
): AsyncGenerator<ConversationEvent> {
	const iterator = payloads[Symbol.asyncIterator]();
	try {
		for (;;) {
			let next:
				| IteratorResult<import('./conversationEvents').RawConversationPayload | null | undefined>
				| typeof TIMED_OUT;
			try {
				const step = iterator.next();
				next = await nextWithTimeout(step, options.inactivityTimeoutMs);
				if (next === TIMED_OUT) {
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
		Promise.resolve(iterator.return?.(undefined)).catch(() => {});
	}
}
