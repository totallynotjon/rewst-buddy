import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import { MCP_PROTOCOL_VERSION, mcpAuthorizationHeader, parseBearerToken } from './protocol';

suite('Unit: MCP protocol authentication helpers', () => {
	test('keeps the advertised in-extension protocol version stable', () => {
		assert.strictEqual(MCP_PROTOCOL_VERSION, 1);
	});

	test('formats a standard bearer authorization value without rewriting the token', () => {
		assert.strictEqual(mcpAuthorizationHeader('abc.DEF_123-xyz'), 'Bearer abc.DEF_123-xyz');
	});

	test('parses bearer scheme case-insensitively with spaces or horizontal tabs', () => {
		assert.strictEqual(parseBearerToken('Bearer token'), 'token');
		assert.strictEqual(parseBearerToken('bearer   token'), 'token');
		assert.strictEqual(parseBearerToken('BEARER\t token'), 'token');
		assert.strictEqual(parseBearerToken('  Bearer token  '), 'token');
	});

	test('preserves opaque token punctuation', () => {
		assert.strictEqual(parseBearerToken('Bearer abc.DEF_123-~+/='), 'abc.DEF_123-~+/=');
	});

	test('rejects missing values, wrong schemes, and a glued scheme', () => {
		for (const value of [undefined, '', '   ', 'Bearer', 'Bearer   ', 'Basic token', 'BearerToken']) {
			assert.strictEqual(parseBearerToken(value), undefined, String(value));
		}
	});

	test('rejects multiple credentials or whitespace inside the token', () => {
		for (const value of ['Bearer first second', 'Bearer first\tsecond', 'Bearer first, Bearer second']) {
			assert.strictEqual(parseBearerToken(value), undefined, value);
		}
	});

	test('rejects line breaks and control characters in the credential', () => {
		for (const value of ['Bearer first\r\nsecond', 'Bearer first\nsecond', 'Bearer first\0second']) {
			assert.strictEqual(parseBearerToken(value), undefined, JSON.stringify(value));
		}
	});
});
