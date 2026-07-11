import { LinkManager } from '@models';
import { initTestEnvironment } from '@test';
import { log } from '@utils';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { removeLinkForUri } from './linkCore';

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

suite('Unit: removeLinkForUri()', () => {
	const restores: Restore[] = [];
	const uri = vscode.Uri.file('/workspace/template.jinja');
	let notices: string[];

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		notices = [];
		restores.push(stub(log, 'notifyInfo', ((message: string) => notices.push(message)) as typeof log.notifyInfo));
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
		LinkManager._resetForTesting();
	});

	test('rejects an unlinked URI without attempting persistence or reporting success', async () => {
		let removeCalls = 0;
		restores.push(stub(LinkManager, 'isLinked', (() => false) as typeof LinkManager.isLinked));
		restores.push(
			stub(LinkManager, 'removeLink', (async () => {
				removeCalls++;
			}) as unknown as typeof LinkManager.removeLink),
		);

		await assert.rejects(() => removeLinkForUri(uri, 'missing link', 'removed link'), /missing link/);
		assert.strictEqual(removeCalls, 0);
		assert.deepStrictEqual(notices, []);
	});

	test('passes the canonical URI string and waits for removal before reporting success', async () => {
		let received: string | undefined;
		let release!: () => void;
		const pending = new Promise<void>(resolve => {
			release = resolve;
		});
		restores.push(stub(LinkManager, 'isLinked', (() => true) as typeof LinkManager.isLinked));
		restores.push(
			stub(LinkManager, 'removeLink', ((uriString: string) => {
				received = uriString;
				return pending;
			}) as unknown as typeof LinkManager.removeLink),
		);

		const execution = removeLinkForUri(uri, 'missing link', 'removed link');
		await Promise.resolve();
		assert.strictEqual(received, uri.toString());
		assert.deepStrictEqual(notices, []);

		release();
		await execution;
		assert.deepStrictEqual(notices, ['removed link']);
	});

	test('propagates removal failure and never emits the success notification', async () => {
		const expected = new Error('persistence failed');
		restores.push(stub(LinkManager, 'isLinked', (() => true) as typeof LinkManager.isLinked));
		restores.push(
			stub(LinkManager, 'removeLink', (async () => {
				throw expected;
			}) as unknown as typeof LinkManager.removeLink),
		);

		await assert.rejects(
			() => removeLinkForUri(uri, 'missing link', 'removed link'),
			error => error === expected,
		);
		assert.deepStrictEqual(notices, []);
	});
});
