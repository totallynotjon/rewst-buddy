import { expect, vi } from 'vitest';
import { teardown as afterEach, setup as beforeEach, suite as describe, test as it } from '../../test/tdd';
import { askRewstAi, seedConversation, type AskOptions, type SeedChunk } from './ConversationClient';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../backend/operations', () => ({ invoke: mocks.invoke }));

describe('editor conversation cleanup', () => {
	let finish: () => void;
	let operationSignal: AbortSignal;
	let operationClosed: boolean;
	beforeEach(() => {
		operationClosed = false;
		mocks.invoke.mockReset();
		mocks.invoke.mockImplementation((_operation, input, options) => {
			operationSignal = options.signal;
			return new Promise(resolve => {
				finish = () => {
					operationClosed = true;
					resolve({ streamId: input.streamId });
				};
				operationSignal.addEventListener('abort', finish, { once: true });
				options.onEvent({
					streamId: input.streamId,
					event: { kind: 'status', activity: 'Native tool requested', tool: { name: 'native_tool' } },
				});
			});
		});
	});
	afterEach(() => finish?.());

	for (const cancellationType of ['none', 'vscode', 'abort-signal'] as const) {
		it(`closes a redirected backend turn with ${cancellationType} cancellation`, async () => {
			const callerAbort = new AbortController();
			const disposeListener = vi.fn();
			const cancellation: AskOptions['cancellation'] =
				cancellationType === 'none'
					? undefined
					: cancellationType === 'abort-signal'
						? callerAbort.signal
						: {
								isCancellationRequested: false,
								onCancellationRequested: () => ({ dispose: disposeListener }),
							};
			const iterator = askRewstAi({
				session: { sessionId: 'user-1', profile: { user: { id: 'user-1' } } } as AskOptions['session'],
				orgId: 'org-1',
				message: 'Use a local tool',
				cancellation,
			});
			expect((await iterator.next()).value).toMatchObject({ kind: 'status' });
			// The provider exits the old iterator when it redirects a native tool,
			// while the overall chat cancellation token remains live for the retry.
			await iterator.return(undefined);
			expect(operationSignal.aborted).toBe(true);
			expect(operationClosed).toBe(true);
			expect(callerAbort.signal.aborted).toBe(false);
			if (cancellationType === 'vscode') expect(disposeListener).toHaveBeenCalledOnce();
		});
	}

	it('forwards caller cancellation to its owned operation signal', async () => {
		const callerAbort = new AbortController();
		const iterator = askRewstAi({
			session: { sessionId: 'user-1', profile: { user: { id: 'user-1' } } } as AskOptions['session'],
			orgId: 'org-1',
			message: 'Use a local tool',
			cancellation: callerAbort.signal,
		});
		await iterator.next();
		callerAbort.abort();
		expect(operationSignal.aborted).toBe(true);
		expect(operationClosed).toBe(true);
		expect(await iterator.next()).toEqual({ done: true, value: undefined });
	});

	it('seeds a disposable conversation through the trusted editor operation', async () => {
		mocks.invoke.mockResolvedValueOnce('conv-seeded');
		const chunks: SeedChunk[] = [
			{ role: 'USER', content: 'what is a trigger?' },
			{ role: 'ASSISTANT', content: 'An event that starts a workflow.' },
		];
		const session = { sessionId: 'user-1', profile: { user: { id: 'user-1' } } } as AskOptions['session'];

		await expect(seedConversation(session, 'org-1', 'HELP_DOCS', chunks)).resolves.toBe('conv-seeded');
		expect(mocks.invoke).toHaveBeenCalledWith('conversation.seed', {
			sessionId: 'user-1',
			orgId: 'org-1',
			conversationType: 'HELP_DOCS',
			chunks,
		});
	});
});
