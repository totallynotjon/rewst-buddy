import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { initTestEnvironment, stub } from '@test';
import { REWST_REMOTE_SCHEME, RewstContentProvider } from './RewstContentProvider';

const { suite, test, setup, teardown, suiteSetup, suiteTeardown } = Mocha;

suite('Unit: RewstContentProvider', () => {
	suiteSetup(() => {
		RewstContentProvider.init();
	});

	suiteTeardown(() => {
		RewstContentProvider.dispose();
	});

	setup(() => {
		initTestEnvironment();
		RewstContentProvider._resetForTesting();
	});

	teardown(() => {
		RewstContentProvider._resetForTesting();
	});

	test('put() returns a rewst-remote-scheme uri preserving the target path', () => {
		const target = vscode.Uri.file('/a/b.js');
		const remote = RewstContentProvider.put(target, 'body');
		assert.strictEqual(remote.scheme, REWST_REMOTE_SCHEME);
		assert.strictEqual(remote.path, target.path);
	});

	test('provideTextDocumentContent returns stored content for a put uri', () => {
		const target = vscode.Uri.file('/a/b.js');
		const remote = RewstContentProvider.put(target, 'hello world');
		assert.strictEqual(RewstContentProvider.provideTextDocumentContent(remote), 'hello world');
	});

	test('provideTextDocumentContent returns empty string for an unknown uri', () => {
		const unknown = vscode.Uri.file('/a/b.js').with({ scheme: REWST_REMOTE_SCHEME, query: 'rewst-remote=999' });
		assert.strictEqual(RewstContentProvider.provideTextDocumentContent(unknown), '');
	});

	test('remove() deletes stored content', () => {
		const target = vscode.Uri.file('/a/b.js');
		const remote = RewstContentProvider.put(target, 'hello');
		RewstContentProvider.remove(remote);
		assert.strictEqual(RewstContentProvider.provideTextDocumentContent(remote), '');
	});

	test('two put() calls for the same target return distinct uris', () => {
		const target = vscode.Uri.file('/a/b.js');
		const first = RewstContentProvider.put(target, 'a');
		const second = RewstContentProvider.put(target, 'b');
		assert.notStrictEqual(first.toString(), second.toString());
		assert.strictEqual(RewstContentProvider.provideTextDocumentContent(first), 'a');
		assert.strictEqual(RewstContentProvider.provideTextDocumentContent(second), 'b');
	});

	test('closing a rewst-remote document clears its stored content', () => {
		// Driving a real tab close through the extension host's window/tab
		// manager is not reliable in a headless test run (no event fires even
		// after an extended timeout), matching this repo's existing precedent
		// that tab-interaction behavior isn't practically unit-testable — see
		// ApplyRewstAiEdit.closeDiffTabs. So this exercises the registered
		// onDidCloseTextDocument handler directly instead of the real UI path.
		RewstContentProvider.dispose();
		let closeHandler: ((doc: vscode.TextDocument) => void) | undefined;
		const restoreEvent = stub(vscode.workspace, 'onDidCloseTextDocument', ((
			listener: (doc: vscode.TextDocument) => void,
		) => {
			closeHandler = listener;
			return { dispose() {} };
		}) as typeof vscode.workspace.onDidCloseTextDocument);

		try {
			RewstContentProvider.init();
			const target = vscode.Uri.file('/a/b.js');
			const remote = RewstContentProvider.put(target, 'hello');
			assert.ok(closeHandler, 'expected RewstContentProvider.init() to register a close listener');

			closeHandler!({ uri: remote } as vscode.TextDocument);

			assert.strictEqual(RewstContentProvider.provideTextDocumentContent(remote), '');
		} finally {
			RewstContentProvider.dispose();
			restoreEvent();
			RewstContentProvider.init();
		}
	});
});
