import { TemplateBundleManager } from '@models';
import { Server } from '@server';
import { SessionManager } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { BundleTemplates } from './template/BundleTemplates';
import { ClearSessions } from './sessions/ClearSessions';
import { NewSession } from './sessions/NewSession';
import { StopServer } from './server/StopServer';

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

suite('Unit: lifecycle command adapters', () => {
	const restores: Restore[] = [];
	let infoMessages: string[];

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		TemplateBundleManager._resetForTesting();
		infoMessages = [];
		restores.push(
			stub(vscode.window, 'showInformationMessage', ((message: string) => {
				infoMessages.push(message);
				return Promise.resolve(undefined);
			}) as unknown as typeof vscode.window.showInformationMessage),
		);
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
		SessionManager._resetForTesting();
		TemplateBundleManager._resetForTesting();
	});

	test('ClearSessions awaits profile deletion before reporting success', async () => {
		let release!: () => void;
		const pending = new Promise<void>(resolve => {
			release = resolve;
		});
		restores.push(stub(SessionManager, 'clearProfiles', (() => pending) as typeof SessionManager.clearProfiles));

		const execution = new ClearSessions().execute('ignored');
		await Promise.resolve();
		assert.deepStrictEqual(infoMessages, []);

		release();
		await execution;
		assert.deepStrictEqual(infoMessages, ['Cleared saved sessions']);
	});

	test('ClearSessions propagates deletion failure and does not report success', async () => {
		const expected = new Error('secret storage unavailable');
		restores.push(
			stub(SessionManager, 'clearProfiles', (async () => {
				throw expected;
			}) as typeof SessionManager.clearProfiles),
		);

		await assert.rejects(
			() => new ClearSessions().execute(),
			error => error === expected,
		);
		assert.deepStrictEqual(infoMessages, []);
	});

	test('NewSession validates the created session before reporting its label', async () => {
		const { session } = createMockSession({ profile: { label: 'User (Org)' } });
		let validations = 0;
		Object.defineProperty(session, 'validate', {
			configurable: true,
			value: async () => {
				validations++;
				return true;
			},
		});
		restores.push(
			stub(SessionManager, 'createSession', (async () => session) as typeof SessionManager.createSession),
		);

		await new NewSession().execute();

		assert.strictEqual(validations, 1);
		assert.deepStrictEqual(infoMessages, ["Created new session for 'User (Org)'"]);
	});

	test('NewSession stays silent when the newly created session does not validate', async () => {
		const { session } = createMockSession();
		Object.defineProperty(session, 'validate', { configurable: true, value: async () => false });
		restores.push(
			stub(SessionManager, 'createSession', (async () => session) as typeof SessionManager.createSession),
		);

		await new NewSession().execute();

		assert.deepStrictEqual(infoMessages, []);
	});

	test('NewSession propagates creation and validation errors without a success message', async () => {
		const createError = new Error('creation failed');
		restores.push(
			stub(SessionManager, 'createSession', (async () => {
				throw createError;
			}) as typeof SessionManager.createSession),
		);
		await assert.rejects(
			() => new NewSession().execute(),
			error => error === createError,
		);
		assert.deepStrictEqual(infoMessages, []);
		restores.pop()!.restore();

		const { session } = createMockSession();
		const validateError = new Error('validation failed');
		Object.defineProperty(session, 'validate', {
			configurable: true,
			value: async () => {
				throw validateError;
			},
		});
		restores.push(
			stub(SessionManager, 'createSession', (async () => session) as typeof SessionManager.createSession),
		);
		await assert.rejects(
			() => new NewSession().execute(),
			error => error === validateError,
		);
		assert.deepStrictEqual(infoMessages, []);
	});

	test('StopServer reports the already-stopped state without calling stop', async () => {
		let stopCalls = 0;
		restores.push(stub(Server, 'getStatus', (() => false) as typeof Server.getStatus));
		restores.push(
			stub(Server, 'stop', (async () => {
				stopCalls++;
			}) as typeof Server.stop),
		);

		await new StopServer().execute();

		assert.strictEqual(stopCalls, 0);
		assert.deepStrictEqual(infoMessages, ['Server is not running']);
	});

	test('StopServer awaits shutdown before reporting success', async () => {
		let release!: () => void;
		const pending = new Promise<void>(resolve => {
			release = resolve;
		});
		restores.push(stub(Server, 'getStatus', (() => true) as typeof Server.getStatus));
		restores.push(stub(Server, 'stop', (() => pending) as typeof Server.stop));

		const execution = new StopServer().execute();
		await Promise.resolve();
		assert.deepStrictEqual(infoMessages, []);

		release();
		await execution;
		assert.deepStrictEqual(infoMessages, ['Server stopped']);
	});

	test('StopServer propagates shutdown failure without reporting a stopped server', async () => {
		const expected = new Error('close failed');
		restores.push(stub(Server, 'getStatus', (() => true) as typeof Server.getStatus));
		restores.push(
			stub(Server, 'stop', (async () => {
				throw expected;
			}) as typeof Server.stop),
		);

		await assert.rejects(
			() => new StopServer().execute(),
			error => error === expected,
		);
		assert.deepStrictEqual(infoMessages, []);
	});

	test('BundleTemplates awaits a rebuild and propagates rebuild failures', async () => {
		let calls = 0;
		restores.push(
			stub(TemplateBundleManager, 'buildBundles', (async () => {
				calls++;
			}) as typeof TemplateBundleManager.buildBundles),
		);
		await new BundleTemplates().execute();
		assert.strictEqual(calls, 1);
		restores.pop()!.restore();

		const expected = new Error('bundle build failed');
		restores.push(
			stub(TemplateBundleManager, 'buildBundles', (async () => {
				throw expected;
			}) as typeof TemplateBundleManager.buildBundles),
		);
		await assert.rejects(
			() => new BundleTemplates().execute(),
			error => error === expected,
		);
	});
});
