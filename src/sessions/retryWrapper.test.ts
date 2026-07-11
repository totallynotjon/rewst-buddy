import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createRetryWrapper } from './retryWrapper';

const { suite, test, setup } = Mocha;

suite('Unit: createRetryWrapper()', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('returns a successful result without retrying', async () => {
		let calls = 0;
		const wrapped = createRetryWrapper({ maxRetries: 3, baseDelay: 0, maxDelay: 0 });

		const result = await wrapped(async () => {
			calls++;
			return { ok: true };
		}, 'ListWorkflows');

		assert.deepStrictEqual(result, { ok: true });
		assert.strictEqual(calls, 1);
	});

	test('retries common transient network and gateway failures case-insensitively', async () => {
		const messages = [
			'connect ETIMEDOUT',
			'Request timeout',
			'Network connection lost',
			'read ECONNRESET',
			'getaddrinfo ENOTFOUND api.example.test',
			'Socket hang up',
			'HTTP 500',
			'HTTP 502',
			'HTTP 503',
			'HTTP 504',
		];

		for (const message of messages) {
			let calls = 0;
			const wrapped = createRetryWrapper({ maxRetries: 1, baseDelay: 0, maxDelay: 0 });
			const result = await wrapped(async () => {
				calls++;
				if (calls === 1) throw new Error(message);
				return 'recovered';
			}, 'TransientOperation');
			assert.strictEqual(result, 'recovered', message);
			assert.strictEqual(calls, 2, message);
		}
	});

	test('does not retry authentication, validation, or business errors', async () => {
		for (const message of ['Unauthorized', 'Forbidden', 'Validation failed', 'Workflow not found']) {
			let calls = 0;
			const expected = new Error(message);
			const wrapped = createRetryWrapper({ maxRetries: 5, baseDelay: 0, maxDelay: 0 });

			await assert.rejects(
				() =>
					wrapped(async () => {
						calls++;
						throw expected;
					}, 'PermanentOperation'),
				error => error === expected,
			);
			assert.strictEqual(calls, 1, message);
		}
	});

	test('makes exactly maxRetries plus one attempts before surfacing the original error', async () => {
		let calls = 0;
		const expected = new Error('network remains unavailable');
		const wrapped = createRetryWrapper({ maxRetries: 2, baseDelay: 0, maxDelay: 0 });

		await assert.rejects(
			() =>
				wrapped(async () => {
					calls++;
					throw expected;
				}, 'PersistentFailure'),
			error => error === expected,
		);
		assert.strictEqual(calls, 3);
	});

	test('supports disabling retries with maxRetries zero', async () => {
		let calls = 0;
		const wrapped = createRetryWrapper({ maxRetries: 0, baseDelay: 0, maxDelay: 0 });

		await assert.rejects(() =>
			wrapped(async () => {
				calls++;
				throw new Error('network unavailable');
			}, 'NoRetryOperation'),
		);
		assert.strictEqual(calls, 1);
	});

	test('uses exponential delays capped by maxDelay', async () => {
		const originalSetTimeout = globalThis.setTimeout;
		const delays: number[] = [];
		Object.defineProperty(globalThis, 'setTimeout', {
			configurable: true,
			writable: true,
			value: ((callback: () => void, delay?: number) => {
				delays.push(delay ?? 0);
				callback();
				return 0;
			}) as unknown as typeof setTimeout,
		});
		try {
			let calls = 0;
			const wrapped = createRetryWrapper({ maxRetries: 3, baseDelay: 10, maxDelay: 15 });
			const result = await wrapped(async () => {
				calls++;
				if (calls < 4) throw new Error('network unavailable');
				return 'ok';
			}, 'BackoffOperation');

			assert.strictEqual(result, 'ok');
			assert.deepStrictEqual(delays, [10, 15, 15]);
		} finally {
			Object.defineProperty(globalThis, 'setTimeout', {
				configurable: true,
				writable: true,
				value: originalSetTimeout,
			});
		}
	});

	test('preserves a non-Error rejection instead of replacing it with a classifier TypeError', async () => {
		const wrapped = createRetryWrapper({ maxRetries: 2, baseDelay: 0, maxDelay: 0 });
		let caught: unknown;
		try {
			await wrapped(async () => Promise.reject('offline'), 'UnusualRejection');
		} catch (error) {
			caught = error;
		}

		assert.strictEqual(caught, 'offline');
	});
});
