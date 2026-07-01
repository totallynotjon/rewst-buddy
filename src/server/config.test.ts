import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import { formatHostPort, isLoopbackHost } from './config';

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

suite('Unit: isLoopbackHost', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('accepts every documented loopback form', () => {
		assert.strictEqual(isLoopbackHost('127.0.0.1'), true);
		assert.strictEqual(isLoopbackHost('localhost'), true);
		assert.strictEqual(isLoopbackHost('::1'), true);
		assert.strictEqual(isLoopbackHost('[::1]'), true);
	});

	test('is case-insensitive', () => {
		assert.strictEqual(isLoopbackHost('LOCALHOST'), true);
		assert.strictEqual(isLoopbackHost('LocalHost'), true);
	});

	test('trims surrounding whitespace', () => {
		assert.strictEqual(isLoopbackHost('  127.0.0.1  '), true);
		assert.strictEqual(isLoopbackHost(' localhost '), true);
		assert.strictEqual(isLoopbackHost(' ::1 '), true);
	});

	test('rejects wildcard binds', () => {
		assert.strictEqual(isLoopbackHost('0.0.0.0'), false);
		assert.strictEqual(isLoopbackHost('::'), false);
		assert.strictEqual(isLoopbackHost('[::]'), false);
	});

	test('rejects LAN, public, and arbitrary hostnames', () => {
		assert.strictEqual(isLoopbackHost('192.168.1.10'), false);
		assert.strictEqual(isLoopbackHost('10.0.0.5'), false);
		assert.strictEqual(isLoopbackHost('8.8.8.8'), false);
		assert.strictEqual(isLoopbackHost('example.com'), false);
	});

	test('rejects an empty host', () => {
		assert.strictEqual(isLoopbackHost(''), false);
		assert.strictEqual(isLoopbackHost('   '), false);
	});
});
