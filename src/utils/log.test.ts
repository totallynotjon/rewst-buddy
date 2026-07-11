import { context } from '@global';
import { createMockContext } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { log } from './log';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

function stub<T extends object, K extends keyof T>(object: T, key: K, value: T[K]): Restore {
	const original = object[key];
	Object.defineProperty(object, key, { configurable: true, writable: true, value });
	return {
		restore() {
			Object.defineProperty(object, key, { configurable: true, writable: true, value: original });
		},
	};
}

interface ChannelCall {
	level: string;
	args: unknown[];
}

function fakeChannel() {
	const calls: ChannelCall[] = [];
	const shows: boolean[] = [];
	let disposed = 0;
	const channel = {
		name: 'rewst-buddy',
		logLevel: vscode.LogLevel.Trace,
		onDidChangeLogLevel: new vscode.EventEmitter<vscode.LogLevel>().event,
		trace: (...args: unknown[]) => calls.push({ level: 'trace', args }),
		debug: (...args: unknown[]) => calls.push({ level: 'debug', args }),
		info: (...args: unknown[]) => calls.push({ level: 'info', args }),
		warn: (...args: unknown[]) => calls.push({ level: 'warn', args }),
		error: (...args: unknown[]) => calls.push({ level: 'error', args }),
		append: () => {},
		appendLine: () => {},
		replace: () => {},
		clear: () => {},
		show: (preserveFocus?: boolean) => shows.push(preserveFocus ?? false),
		hide: () => {},
		dispose: () => disposed++,
	};
	return { channel: channel as unknown as vscode.LogOutputChannel, calls, shows, disposed: () => disposed };
}

suite('Unit: logger boundary', () => {
	const restores: Restore[] = [];
	let fake: ReturnType<typeof fakeChannel>;
	let extensionContext: vscode.ExtensionContext;

	setup(() => {
		extensionContext = createMockContext();
		context.init(extensionContext);
		fake = fakeChannel();
		restores.push(
			stub(vscode.window, 'createOutputChannel', ((name: string, options: { log: true }) => {
				assert.strictEqual(name, 'rewst-buddy');
				assert.deepStrictEqual(options, { log: true });
				return fake.channel;
			}) as typeof vscode.window.createOutputChannel),
		);
		log.init();
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
	});

	test('registers the log channel for extension disposal and records initialization mode', () => {
		assert.ok(extensionContext.subscriptions.includes(fake.channel));
		assert.deepStrictEqual(fake.calls[0], {
			level: 'info',
			args: ['Logger initialized (PRODUCTION mode)'],
		});
	});

	test('forwards trace, debug, info, and warning arguments without serialization', () => {
		const detail = { orgId: 'org-1' };
		log.trace('trace message', detail);
		log.debug('debug message', 2);
		log.info('info message', true);
		log.warn('warn message', null);

		assert.deepStrictEqual(fake.calls.slice(1), [
			{ level: 'trace', args: ['trace message', detail] },
			{ level: 'debug', args: ['debug message', 2] },
			{ level: 'info', args: ['info message', true] },
			{ level: 'warn', args: ['warn message', null] },
		]);
	});

	test('returns a caller-safe combined Error while logging the original Error object', () => {
		const cause = new Error('socket closed');
		const returned = log.error('Request failed:', cause, { attempt: 2 });

		assert.notStrictEqual(returned, cause);
		assert.strictEqual(returned.message, 'Request failed: socket closed');
		assert.deepStrictEqual(fake.calls[fake.calls.length - 1], {
			level: 'error',
			args: ['Request failed:', cause, { attempt: 2 }],
		});
	});

	test('stringifies non-Error rejection reasons in the returned Error', () => {
		assert.strictEqual(log.error('Failed:', 'offline').message, 'Failed: offline');
		assert.strictEqual(log.error('Failed:', { code: 7 }).message, 'Failed: [object Object]');
	});

	test('does not silently discard falsy but explicit rejection reasons', () => {
		assert.strictEqual(log.error('Failed:', 0).message, 'Failed: 0');
		assert.strictEqual(log.error('Failed:', false).message, 'Failed: false');
		assert.strictEqual(log.error('Failed:', '').message, 'Failed: ');
	});

	test('notification helpers log and show the same user-facing message', () => {
		const info: string[] = [];
		const warnings: string[] = [];
		const errors: string[] = [];
		restores.push(
			stub(vscode.window, 'showInformationMessage', ((message: string) => {
				info.push(message);
			}) as unknown as typeof vscode.window.showInformationMessage),
		);
		restores.push(
			stub(vscode.window, 'showWarningMessage', ((message: string) => {
				warnings.push(message);
			}) as unknown as typeof vscode.window.showWarningMessage),
		);
		restores.push(
			stub(vscode.window, 'showErrorMessage', ((message: string) => {
				errors.push(message);
			}) as unknown as typeof vscode.window.showErrorMessage),
		);

		log.notifyInfo('Connected');
		log.notifyWarn('Token expires soon');
		const returned = log.notifyError('Connection failed:', new Error('denied'));

		assert.deepStrictEqual(info, ['Connected']);
		assert.deepStrictEqual(warnings, ['Token expires soon']);
		assert.deepStrictEqual(errors, ['Connection failed: denied']);
		assert.strictEqual(returned.message, 'Connection failed: denied');
	});

	test('show preserves focus by default and honors an explicit false value', () => {
		log.show();
		log.show(false);
		assert.deepStrictEqual(fake.shows, [true, false]);
	});

	test('mirrors messages to the console only in development mode', () => {
		const development = createMockContext();
		Object.defineProperty(development, 'extensionMode', { value: vscode.ExtensionMode.Development });
		context.init(development);
		const consoleMessages: unknown[][] = [];
		restores.push(stub(console, 'log', ((...args: unknown[]) => consoleMessages.push(args)) as typeof console.log));

		log.init();
		log.trace('details', 1);

		assert.ok(consoleMessages.some(args => args[0] === '[INFO] Logger initialized (DEVELOPMENT mode)'));
		assert.ok(consoleMessages.some(args => args[0] === '[TRACE] details' && args[1] === 1));
	});
});
