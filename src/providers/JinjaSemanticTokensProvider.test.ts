import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { LinkManager } from '@models';
import { initTestEnvironment } from '@test';
import { JinjaSemanticTokensProvider } from './JinjaSemanticTokensProvider';

const { suite, test, setup, teardown } = Mocha;

function makeDoc(uri: vscode.Uri, lines: string[]): vscode.TextDocument {
	return {
		uri,
		lineCount: lines.length,
		lineAt: (i: number) => ({ text: lines[i] }) as unknown as vscode.TextLine,
	} as unknown as vscode.TextDocument;
}

function link(uri: vscode.Uri) {
	return {
		uriString: uri.toString(),
		org: { id: 'org-1', name: 'Org 1' },
		type: 'Template' as const,
		template: { id: 't1', name: 'T1', updatedAt: '' } as any,
		bodyHash: 'hash',
	};
}

suite('Unit: JinjaSemanticTokensProvider', () => {
	const uri = vscode.Uri.file('/test/linked.txt');
	const provider = new JinjaSemanticTokensProvider();
	const dummyToken = {} as vscode.CancellationToken;

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
	});

	teardown(() => {
		LinkManager._resetForTesting();
	});

	test('unlinked document → undefined immediately', () => {
		const doc = makeDoc(uri, ['{% try %}']);
		const result = provider.provideDocumentSemanticTokens(doc, dummyToken);
		assert.strictEqual(result, undefined);
	});

	test('try/catch inside {% %} on a linked document → tokenized as keywords', () => {
		LinkManager.addLink(link(uri));
		const line = '{% try %}...{% catch %}';
		const doc = makeDoc(uri, [line]);
		const result = provider.provideDocumentSemanticTokens(doc, dummyToken) as vscode.SemanticTokens;
		assert.ok(result);
		assert.strictEqual(result.data.length, 10); // 2 tokens * 5 fields
		const tryStart = line.indexOf('try');
		assert.strictEqual(result.data[0], 0); // deltaLine
		assert.strictEqual(result.data[1], tryStart); // deltaStartChar (absolute for first token)
		assert.strictEqual(result.data[2], 'try'.length); // length
	});

	test('same keyword text in plain prose outside any span → not tokenized', () => {
		LinkManager.addLink(link(uri));
		const doc = makeDoc(uri, ['for the record, no jinja here']);
		const result = provider.provideDocumentSemanticTokens(doc, dummyToken) as vscode.SemanticTokens;
		assert.strictEqual(result.data.length, 0);
	});
});
