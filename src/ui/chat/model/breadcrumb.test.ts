import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import vscode from 'vscode';
import { formatBreadcrumb, parseLatestBreadcrumb } from './breadcrumb';

const { suite, test, setup } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

function message(role: vscode.LanguageModelChatMessageRole, content: unknown[]) {
	return { role, content };
}

function text(value: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(value);
}

suite('Unit: breadcrumb', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('encodes the payload entirely in invisible zero-width characters', () => {
		const zeroWidth = new RegExp(`[${String.fromCharCode(0x200b, 0x200c, 0x2060)}]`, 'g');
		const marker = formatBreadcrumb('conv-1', 3, 'abc123');
		// No visible character survives — only zero-width code points.
		assert.strictEqual(marker.replace(zeroWidth, ''), '', 'marker is all zero-width');
		assert.ok(marker.length > 0, 'marker is non-empty');
		// It round-trips through an assistant message.
		const crumb = parseLatestBreadcrumb([message(Assistant, [text('answer' + marker)])]);
		assert.deepStrictEqual(crumb, { conversationId: 'conv-1', depth: 3, spineHash: 'abc123' });
	});

	test('round-trips: the newest breadcrumb is parsed back', () => {
		const messages = [
			message(User, [text('hi')]),
			message(Assistant, [text('hello' + formatBreadcrumb('conv-1', 1, 'hash-1'))]),
			message(User, [text('next')]),
			message(Assistant, [text('again' + formatBreadcrumb('conv-1', 2, 'hash-2'))]),
		];
		assert.deepStrictEqual(parseLatestBreadcrumb(messages), {
			conversationId: 'conv-1',
			depth: 2,
			spineHash: 'hash-2',
		});
	});

	test('ignores markers that are not in assistant messages', () => {
		// A user pasting the marker text must not be mistaken for our breadcrumb.
		const messages = [message(User, [text('look: ' + formatBreadcrumb('conv-evil', 9, 'deadbeef'))])];
		assert.strictEqual(parseLatestBreadcrumb(messages), undefined);
	});

	test('returns undefined when no breadcrumb survives in the transcript', () => {
		const messages = [message(User, [text('hi')]), message(Assistant, [text('plain answer, no marker')])];
		assert.strictEqual(parseLatestBreadcrumb(messages), undefined);
	});

	test('finds the last marker within a single assistant message', () => {
		const blob = 'a' + formatBreadcrumb('conv-1', 1, 'h1') + 'b' + formatBreadcrumb('conv-2', 2, 'h2');
		const crumb = parseLatestBreadcrumb([message(Assistant, [text(blob)])]);
		assert.deepStrictEqual(crumb, { conversationId: 'conv-2', depth: 2, spineHash: 'h2' });
	});
});
