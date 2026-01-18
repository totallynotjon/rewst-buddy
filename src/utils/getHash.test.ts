import * as assert from 'assert';
import * as Mocha from 'mocha';
import { getHash } from './getHash';

const { suite, test } = Mocha;

suite('Unit: getHash()', () => {
	test('should return consistent hash for same input', () => {
		const input = 'test string';
		const hash1 = getHash(input);
		const hash2 = getHash(input);
		assert.strictEqual(hash1, hash2);
	});

	test('should return different hashes for different inputs', () => {
		const hash1 = getHash('string one');
		const hash2 = getHash('string two');
		assert.notStrictEqual(hash1, hash2);
	});

	test('should return a 64 character hex string by default (sha256)', () => {
		const hash = getHash('test');
		assert.strictEqual(hash.length, 64);
		assert.match(hash, /^[a-f0-9]+$/);
	});

	test('should handle empty strings', () => {
		const hash = getHash('');
		assert.strictEqual(typeof hash, 'string');
		assert.strictEqual(hash.length, 64);
	});

	test('should handle unicode characters', () => {
		const hash = getHash('こんにちは世界 🌍');
		assert.strictEqual(hash.length, 64);
	});
});
