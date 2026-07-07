/**
 * Unit tests for JinjaRenderedContentProvider — the live-refreshing virtual
 * document that replaces the old webview's rendered-output pane.
 *
 * Runner: mocha extension-host.
 */

import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import {
	JINJA_RENDER_PLACEHOLDER,
	JINJA_RENDER_SCHEME,
	JinjaRenderedContentProvider,
} from './JinjaRenderedContentProvider';

const { suite, test, setup, teardown, suiteSetup, suiteTeardown } = Mocha;

suite('Unit: JinjaRenderedContentProvider', () => {
	suiteSetup(() => {
		JinjaRenderedContentProvider.init();
	});

	suiteTeardown(() => {
		JinjaRenderedContentProvider.dispose();
	});

	setup(() => {
		initTestEnvironment();
		JinjaRenderedContentProvider._resetForTesting();
	});

	teardown(() => {
		JinjaRenderedContentProvider._resetForTesting();
	});

	test('uriFor() returns a stable rewst-jinja-render-scheme uri for the same template id/name', () => {
		const first = JinjaRenderedContentProvider.uriFor('tpl-1', 'Template One');
		const second = JinjaRenderedContentProvider.uriFor('tpl-1', 'Template One');
		assert.strictEqual(first.scheme, JINJA_RENDER_SCHEME);
		assert.strictEqual(first.toString(), second.toString());
	});

	test('uriFor() returns distinct uris for distinct template ids, even with the same name', () => {
		const a = JinjaRenderedContentProvider.uriFor('tpl-a', 'Shared Name');
		const b = JinjaRenderedContentProvider.uriFor('tpl-b', 'Shared Name');
		assert.notStrictEqual(a.toString(), b.toString());
	});

	test('uriFor() reads as the template name, not the raw id, in its path', () => {
		const uri = JinjaRenderedContentProvider.uriFor('019f3437-dba3-7fbe-8998-f2b703f74393', 'My Template');
		assert.ok(uri.path.includes('My Template'), `expected the readable name in the path, got: ${uri.path}`);
	});

	test('provideTextDocumentContent returns a placeholder before any update', () => {
		const uri = JinjaRenderedContentProvider.uriFor('tpl-fresh', 'Fresh Template');
		assert.strictEqual(JinjaRenderedContentProvider.provideTextDocumentContent(uri), JINJA_RENDER_PLACEHOLDER);
	});

	test('update() stores content retrievable via provideTextDocumentContent', () => {
		const uri = JinjaRenderedContentProvider.uriFor('tpl-2', 'Template Two');
		JinjaRenderedContentProvider.update(uri, '{\n  "a": 1\n}');
		assert.strictEqual(JinjaRenderedContentProvider.provideTextDocumentContent(uri), '{\n  "a": 1\n}');
	});

	test('update() fires onDidChange for the updated uri', () => {
		const uri = JinjaRenderedContentProvider.uriFor('tpl-3', 'Template Three');
		const fired: vscode.Uri[] = [];
		const sub = JinjaRenderedContentProvider.onDidChange(changed => fired.push(changed));

		try {
			JinjaRenderedContentProvider.update(uri, 'hello');
			assert.strictEqual(fired.length, 1);
			assert.strictEqual(fired[0].toString(), uri.toString());
		} finally {
			sub.dispose();
		}
	});

	test('clear() removes stored content, reverting to the placeholder', () => {
		const uri = JinjaRenderedContentProvider.uriFor('tpl-4', 'Template Four');
		JinjaRenderedContentProvider.update(uri, 'some content');
		JinjaRenderedContentProvider.clear(uri);
		assert.strictEqual(JinjaRenderedContentProvider.provideTextDocumentContent(uri), JINJA_RENDER_PLACEHOLDER);
	});

	test('_resetForTesting() clears all stored content', () => {
		const uri = JinjaRenderedContentProvider.uriFor('tpl-5', 'Template Five');
		JinjaRenderedContentProvider.update(uri, 'some content');
		JinjaRenderedContentProvider._resetForTesting();
		assert.strictEqual(JinjaRenderedContentProvider.provideTextDocumentContent(uri), JINJA_RENDER_PLACEHOLDER);
	});
});
