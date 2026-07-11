import { SessionManager } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { RewstViewProvider } from './RewstViewProvider';

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

interface FakeView {
	view: vscode.WebviewView;
	webview: {
		html: string;
		options: vscode.WebviewOptions;
		listener?: (message: any) => Promise<void>;
	};
}

function fakeView(): FakeView {
	const state: FakeView['webview'] = {
		html: '',
		options: {},
	};
	const webview = {
		get html() {
			return state.html;
		},
		set html(value: string) {
			state.html = value;
		},
		get options() {
			return state.options;
		},
		set options(value: vscode.WebviewOptions) {
			state.options = value;
		},
		cspSource: 'vscode-webview://test-source',
		asWebviewUri: (uri: vscode.Uri) => vscode.Uri.parse(`vscode-webview://test${uri.path}`),
		onDidReceiveMessage: (listener: (message: any) => Promise<void>) => {
			state.listener = listener;
			return new vscode.Disposable(() => {});
		},
	} as unknown as vscode.Webview;

	return { view: { webview } as unknown as vscode.WebviewView, webview: state };
}

suite('Unit: RewstViewProvider', () => {
	const restores: Restore[] = [];
	const extensionUri = vscode.Uri.file('/extension');

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
		SessionManager._resetForTesting();
	});

	function resolve(): FakeView {
		const fake = fakeView();
		new RewstViewProvider(extensionUri).resolveWebviewView(
			fake.view,
			{} as vscode.WebviewViewResolveContext,
			new vscode.CancellationTokenSource().token,
		);
		return fake;
	}

	test('enables scripts and restricts local resources to the extension media directory', () => {
		const fake = resolve();

		assert.strictEqual(fake.webview.options.enableScripts, true);
		assert.deepStrictEqual(
			fake.webview.options.localResourceRoots?.map(uri => uri.fsPath),
			['/extension/media'],
		);
	});

	test('renders password input, stylesheet, and script without embedding a session token', () => {
		const fake = resolve();
		const html = fake.webview.html;

		assert.match(html, /<input type="password" id="tokenInput"/);
		assert.match(html, /vscode-webview:\/\/test\/extension\/media\/webview\/main\.css/);
		assert.match(html, /vscode-webview:\/\/test\/extension\/media\/webview\/main\.js/);
		assert.doesNotMatch(html, /appSession|test-token|cookie=/i);
	});

	test('uses one 32-character alphanumeric nonce in both CSP and script markup', () => {
		const html = resolve().webview.html;
		const cspNonce = html.match(/script-src 'nonce-([A-Za-z0-9]+)'/)?.[1];
		const scriptNonce = html.match(/<script nonce="([A-Za-z0-9]+)"/)?.[1];

		assert.ok(cspNonce);
		assert.strictEqual(cspNonce?.length, 32);
		assert.strictEqual(scriptNonce, cspNonce);
	});

	test('trims a submitted token exactly once before creating a session', async () => {
		const tokens: string[] = [];
		const { session } = createMockSession();
		restores.push(
			stub(SessionManager, 'createSession', (async (token?: string) => {
				tokens.push(token ?? '');
				return session;
			}) as typeof SessionManager.createSession),
		);
		const fake = resolve();

		await fake.webview.listener?.({ type: 'submitToken', token: '  opaque=token=value  ' });

		assert.deepStrictEqual(tokens, ['opaque=token=value']);
	});

	test('ignores empty, whitespace-only, nullish, and unrelated messages', async () => {
		let calls = 0;
		const { session } = createMockSession();
		restores.push(
			stub(SessionManager, 'createSession', (async () => {
				calls++;
				return session;
			}) as typeof SessionManager.createSession),
		);
		const fake = resolve();

		for (const message of [
			{ type: 'submitToken', token: '' },
			{ type: 'submitToken', token: '   \n\t' },
			{ type: 'submitToken', token: null },
			{ type: 'unknown', token: 'secret' },
		]) {
			await fake.webview.listener?.(message);
		}

		assert.strictEqual(calls, 0);
	});

	test('contains session-creation failures inside the message handler', async () => {
		const expected = new Error('authentication rejected');
		restores.push(
			stub(SessionManager, 'createSession', (async () => {
				throw expected;
			}) as typeof SessionManager.createSession),
		);
		const fake = resolve();

		await assert.doesNotReject(() => fake.webview.listener!({ type: 'submitToken', token: 'bad-token' }));
	});

	test('registers one message listener each time a view is resolved', () => {
		const fake = resolve();
		assert.strictEqual(typeof fake.webview.listener, 'function');
	});
});
