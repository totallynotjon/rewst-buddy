import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { PROPOSED_SCHEME, ProposedContentProvider } from './ProposedContentProvider';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: ProposedContentProvider', () => {
	setup(() => {
		initTestEnvironment();
		ProposedContentProvider.dispose();
	});

	teardown(() => {
		ProposedContentProvider.dispose();
	});

	test('creates a virtual URI that preserves the target path and language-significant extension', () => {
		const target = vscode.Uri.file('/workspace/template.jinja');
		const proposed = ProposedContentProvider.put(target, 'new body');

		assert.strictEqual(proposed.scheme, PROPOSED_SCHEME);
		assert.strictEqual(proposed.path, target.path);
		assert.strictEqual(proposed.authority, target.authority);
		assert.match(proposed.query, /^proposal=\d+$/);
		assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(proposed), 'new body');
	});

	test('gives repeated proposals for the same file distinct URIs and isolated contents', () => {
		const target = vscode.Uri.file('/workspace/template.jinja');
		const first = ProposedContentProvider.put(target, 'first body');
		const second = ProposedContentProvider.put(target, 'second body');

		assert.notStrictEqual(first.toString(), second.toString());
		assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(first), 'first body');
		assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(second), 'second body');
	});

	test('stores empty, multiline, unicode, and null-byte content verbatim', () => {
		const target = vscode.Uri.file('/workspace/template.jinja');
		for (const content of ['', 'line one\nline two', 'café 😀', 'before\0after']) {
			const proposed = ProposedContentProvider.put(target, content);
			assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(proposed), content);
		}
	});

	test('returns an empty document for unknown and removed proposal URIs', () => {
		const unknown = vscode.Uri.parse(`${PROPOSED_SCHEME}:/workspace/unknown.jinja?proposal=missing`);
		assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(unknown), '');

		const proposed = ProposedContentProvider.put(vscode.Uri.file('/workspace/template.jinja'), 'body');
		ProposedContentProvider.remove(proposed);
		assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(proposed), '');
	});

	test('removing one proposal leaves proposals for the same target intact', () => {
		const target = vscode.Uri.file('/workspace/template.jinja');
		const first = ProposedContentProvider.put(target, 'first');
		const second = ProposedContentProvider.put(target, 'second');

		ProposedContentProvider.remove(first);

		assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(first), '');
		assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(second), 'second');
	});

	test('dispose clears every proposal and can be called repeatedly', () => {
		const proposal = ProposedContentProvider.put(vscode.Uri.file('/workspace/template.jinja'), 'body');

		ProposedContentProvider.dispose();

		assert.strictEqual(ProposedContentProvider.provideTextDocumentContent(proposal), '');
		assert.doesNotThrow(() => ProposedContentProvider.dispose());
	});

	test('init registers the proposed scheme and dispose releases the registration', () => {
		let disposed = 0;
		const original = vscode.workspace.registerTextDocumentContentProvider;
		Object.defineProperty(vscode.workspace, 'registerTextDocumentContentProvider', {
			configurable: true,
			writable: true,
			value: ((scheme: string, provider: vscode.TextDocumentContentProvider) => {
				assert.strictEqual(scheme, PROPOSED_SCHEME);
				assert.strictEqual(provider, ProposedContentProvider);
				return new vscode.Disposable(() => disposed++);
			}) as typeof vscode.workspace.registerTextDocumentContentProvider,
		});
		try {
			assert.strictEqual(ProposedContentProvider.init(), ProposedContentProvider);
			ProposedContentProvider.dispose();
			assert.strictEqual(disposed, 1);
		} finally {
			Object.defineProperty(vscode.workspace, 'registerTextDocumentContentProvider', {
				configurable: true,
				writable: true,
				value: original,
			});
		}
	});
});
