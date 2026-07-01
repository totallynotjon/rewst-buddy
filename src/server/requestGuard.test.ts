import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { evaluateRequestGuard, RequestGuardInput } from './requestGuard';

const { suite, test, setup } = Mocha;

function input(overrides: Partial<RequestGuardInput> = {}): RequestGuardInput {
	return {
		remoteAddress: '127.0.0.1',
		headers: { host: '127.0.0.1:27121' },
		...overrides,
	};
}

suite('Unit: requestGuard', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('remote address', () => {
		test('allows a loopback remote address', () => {
			for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
				const result = evaluateRequestGuard(input({ remoteAddress }));
				assert.strictEqual(result.allowed, true, remoteAddress);
			}
		});

		test('rejects a non-loopback remote address before reading any body', () => {
			const result = evaluateRequestGuard(input({ remoteAddress: '203.0.113.5' }));
			assert.strictEqual(result.allowed, false);
		});

		test('rejects a missing remote address', () => {
			const result = evaluateRequestGuard(input({ remoteAddress: undefined }));
			assert.strictEqual(result.allowed, false);
		});
	});

	suite('Host header', () => {
		test('allows loopback host forms', () => {
			for (const host of ['127.0.0.1:27121', 'localhost:27121', '[::1]:27121', 'localhost', '127.0.0.1']) {
				const result = evaluateRequestGuard(input({ headers: { host } }));
				assert.strictEqual(result.allowed, true, host);
			}
		});

		test('is case-insensitive', () => {
			const result = evaluateRequestGuard(input({ headers: { host: 'LOCALHOST:27121' } }));
			assert.strictEqual(result.allowed, true);
		});

		test('rejects a non-local Host header', () => {
			const result = evaluateRequestGuard(input({ headers: { host: 'attacker.example' } }));
			assert.strictEqual(result.allowed, false);
		});

		test('rejects a missing Host header', () => {
			const result = evaluateRequestGuard(input({ headers: {} }));
			assert.strictEqual(result.allowed, false);
		});

		test('rejects a malformed Host header', () => {
			const result = evaluateRequestGuard(input({ headers: { host: 'foo:bar:baz' } }));
			assert.strictEqual(result.allowed, false);
		});
	});

	suite('X-Forwarded-Host', () => {
		test('rejects a non-loopback forwarded host even when Host is loopback', () => {
			const result = evaluateRequestGuard(
				input({ headers: { host: '127.0.0.1:27121', 'x-forwarded-host': 'attacker.example' } }),
			);
			assert.strictEqual(result.allowed, false);
		});

		test('allows a loopback forwarded host', () => {
			const result = evaluateRequestGuard(
				input({ headers: { host: '127.0.0.1:27121', 'x-forwarded-host': 'localhost:27121' } }),
			);
			assert.strictEqual(result.allowed, true);
		});
	});

	suite('Origin header', () => {
		test('allows a request with no Origin header and omits an echoed origin', () => {
			const result = evaluateRequestGuard(input({ headers: { host: '127.0.0.1:27121' } }));
			assert.strictEqual(result.allowed, true);
			assert.strictEqual(result.allowedOrigin, undefined);
		});

		test('rejects a non-loopback http(s) web origin', () => {
			for (const origin of ['http://attacker.example', 'https://attacker.example']) {
				const result = evaluateRequestGuard(input({ headers: { host: '127.0.0.1:27121', origin } }));
				assert.strictEqual(result.allowed, false, origin);
			}
		});

		test('rejects opaque and malformed origins', () => {
			for (const origin of ['null', 'blob:https://attacker.example/asset', 'not a url']) {
				const result = evaluateRequestGuard(input({ headers: { host: '127.0.0.1:27121', origin } }));
				assert.strictEqual(result.allowed, false, origin);
				assert.strictEqual(result.allowedOrigin, undefined, origin);
			}
		});

		test('allows and echoes back a loopback http(s) origin', () => {
			for (const origin of ['http://localhost:5500', 'https://127.0.0.1:9999', 'http://[::1]:5500']) {
				const result = evaluateRequestGuard(input({ headers: { host: '127.0.0.1:27121', origin } }));
				assert.strictEqual(result.allowed, true, origin);
				assert.strictEqual(result.allowedOrigin, origin, origin);
			}
		});

		test('allows and echoes back a browser-extension origin', () => {
			for (const origin of ['chrome-extension://abcdefghijklmnop', 'moz-extension://12345678-1234-1234-1234']) {
				const result = evaluateRequestGuard(input({ headers: { host: '127.0.0.1:27121', origin } }));
				assert.strictEqual(result.allowed, true, origin);
				assert.strictEqual(result.allowedOrigin, origin, origin);
			}
		});
	});

	test('allows a fully local preflight-shaped request', () => {
		const result = evaluateRequestGuard({
			remoteAddress: '127.0.0.1',
			headers: { host: 'localhost:27121', origin: 'http://localhost:5500' },
		});
		assert.strictEqual(result.allowed, true);
		assert.strictEqual(result.allowedOrigin, 'http://localhost:5500');
	});
});
