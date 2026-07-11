import { context } from '@global';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetMcpTokenForTesting, getMcpToken, isValidMcpToken, rotateMcpToken } from './runtime';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: MCP token runtime', () => {
	setup(async () => {
		initTestEnvironment();
		await _resetMcpTokenForTesting();
	});

	teardown(async () => {
		await _resetMcpTokenForTesting();
	});

	test('creates a stable 256-bit lowercase hex token on first use', () => {
		const token = getMcpToken();
		assert.match(token, /^[0-9a-f]{64}$/);
		assert.strictEqual(getMcpToken(), token);
	});

	test('restores an existing persisted token instead of rotating client credentials on reload', async () => {
		const persisted = 'a'.repeat(64);
		await context.globalState.update('RewstMcpToken', persisted);

		assert.strictEqual(getMcpToken(), persisted);
		assert.strictEqual(getMcpToken(), persisted);
	});

	test('caches before asynchronous persistence settles so racing callers see one token', async () => {
		const originalUpdate = context.globalState.update;
		let updateCalls = 0;
		let release!: () => void;
		const pending = new Promise<void>(resolve => {
			release = resolve;
		});
		Object.defineProperty(context.globalState, 'update', {
			configurable: true,
			writable: true,
			value: async () => {
				updateCalls++;
				await pending;
			},
		});
		try {
			const first = getMcpToken();
			const second = getMcpToken();

			assert.strictEqual(second, first);
			assert.strictEqual(updateCalls, 1);
			release();
			await pending;
		} finally {
			Object.defineProperty(context.globalState, 'update', {
				configurable: true,
				writable: true,
				value: originalUpdate,
			});
		}
	});

	test('rotation revokes the old token and keeps the replacement stable', () => {
		const oldToken = getMcpToken();
		const replacement = rotateMcpToken();

		assert.match(replacement, /^[0-9a-f]{64}$/);
		assert.notStrictEqual(replacement, oldToken);
		assert.strictEqual(getMcpToken(), replacement);
		assert.strictEqual(isValidMcpToken(oldToken), false);
		assert.strictEqual(isValidMcpToken(replacement), true);
	});

	test('rejects absent, empty, truncated, extended, and whitespace-padded presentations', () => {
		const token = getMcpToken();
		for (const presented of [undefined, '', token.slice(1), `${token}0`, ` ${token}`, `${token} `]) {
			assert.strictEqual(isValidMcpToken(presented), false, JSON.stringify(presented));
		}
	});

	test('rejects a same-length token differing at the beginning, middle, or end', () => {
		const token = getMcpToken();
		for (const index of [0, Math.floor(token.length / 2), token.length - 1]) {
			const replacement = token[index] === '0' ? '1' : '0';
			const candidate = `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`;
			assert.strictEqual(candidate.length, token.length);
			assert.strictEqual(isValidMcpToken(candidate), false, `index ${index}`);
		}
	});

	test('reset removes both the in-memory and persisted token', async () => {
		const original = getMcpToken();
		await Promise.resolve();
		await _resetMcpTokenForTesting();
		assert.strictEqual(context.globalState.get('RewstMcpToken'), undefined);

		const next = getMcpToken();
		assert.notStrictEqual(next, original);
	});
});
