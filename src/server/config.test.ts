import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import { formatHostPort } from './config';

const { suite, test, setup } = Mocha;

suite('Unit: formatHostPort', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('leaves IPv4 and hostnames unbracketed', () => {
		assert.strictEqual(formatHostPort('127.0.0.1', 27121), '127.0.0.1:27121');
		assert.strictEqual(formatHostPort('localhost', 27121), 'localhost:27121');
	});

	test('brackets bare IPv6 literals', () => {
		assert.strictEqual(formatHostPort('::1', 27121), '[::1]:27121');
		assert.strictEqual(formatHostPort('fe80::1', 8080), '[fe80::1]:8080');
	});

	test('does not double-bracket an already-bracketed IPv6 host', () => {
		assert.strictEqual(formatHostPort('[::1]', 27121), '[::1]:27121');
	});

	test('trims surrounding whitespace', () => {
		assert.strictEqual(formatHostPort('  ::1  ', 27121), '[::1]:27121');
		assert.strictEqual(formatHostPort(' 127.0.0.1 ', 27121), '127.0.0.1:27121');
	});
});
