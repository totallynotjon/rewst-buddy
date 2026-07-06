import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { LinkManager, TemplateMetadataStore } from '@models';
import { initTestEnvironment, stub } from '@test';
import { TemplateNameCompletionProvider } from './TemplateNameCompletionProvider';

const { suite, test, setup, teardown } = Mocha;

function makeDoc(uri: vscode.Uri, text: string): vscode.TextDocument {
	return {
		uri,
		lineAt: () => ({ text }) as unknown as vscode.TextLine,
	} as unknown as vscode.TextDocument;
}

function makeTemplateLink(uri: vscode.Uri, orgId: string, orgName: string) {
	return {
		uriString: uri.toString(),
		org: { id: orgId, name: orgName },
		type: 'Template' as const,
		template: { id: 'template-1', name: 'Template 1', updatedAt: '' } as any,
		bodyHash: 'hash',
	};
}

suite('Unit: TemplateNameCompletionProvider', () => {
	const uri = vscode.Uri.file('/test/linked.txt');
	const provider = new TemplateNameCompletionProvider();
	const dummyToken = {} as vscode.CancellationToken;
	const dummyContext = { triggerKind: vscode.CompletionTriggerKind.Invoke } as vscode.CompletionContext;

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		TemplateMetadataStore._resetForTesting();
	});

	teardown(() => {
		LinkManager._resetForTesting();
		TemplateMetadataStore._resetForTesting();
	});

	test('unlinked document → undefined, no work', () => {
		let calls = 0;
		const restore = stub(TemplateMetadataStore, 'getTemplatesForOrg', () => {
			calls++;
			return [];
		});
		try {
			const line = 'template("';
			const doc = makeDoc(uri, line);
			const result = provider.provideCompletionItems(
				doc,
				new vscode.Position(0, line.length),
				dummyToken,
				dummyContext,
			);
			assert.strictEqual(result, undefined);
			assert.strictEqual(calls, 0);
		} finally {
			restore();
		}
	});

	test('cursor not inside template(" → undefined', () => {
		LinkManager.addLink(makeTemplateLink(uri, 'org-1', 'Org 1'));
		const line = 'no template call here';
		const doc = makeDoc(uri, line);
		const result = provider.provideCompletionItems(doc, new vscode.Position(0, 5), dummyToken, dummyContext);
		assert.strictEqual(result, undefined);
	});

	test('cursor inside template(" → completion items for the org\'s templates', () => {
		LinkManager.addLink(makeTemplateLink(uri, 'org-1', 'Org 1'));
		const restore = stub(TemplateMetadataStore, 'getTemplatesForOrg', (orgId: string) => {
			assert.strictEqual(orgId, 'org-1');
			return [{ id: 'uuid-1', name: 'Alpha' } as any];
		});
		try {
			const line = 'template("';
			const doc = makeDoc(uri, line);
			const result = provider.provideCompletionItems(
				doc,
				new vscode.Position(0, line.length),
				dummyToken,
				dummyContext,
			) as vscode.CompletionItem[];
			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].label, 'Alpha');
		} finally {
			restore();
		}
	});

	test('inserted text is the template id; label/filterText is the name', () => {
		LinkManager.addLink(makeTemplateLink(uri, 'org-1', 'Org 1'));
		const restore = stub(TemplateMetadataStore, 'getTemplatesForOrg', () => [
			{ id: 'uuid-1', name: 'Alpha' } as any,
		]);
		try {
			const line = 'template("';
			const doc = makeDoc(uri, line);
			const result = provider.provideCompletionItems(
				doc,
				new vscode.Position(0, line.length),
				dummyToken,
				dummyContext,
			) as vscode.CompletionItem[];
			assert.strictEqual(result[0].label, 'Alpha');
			assert.strictEqual(result[0].insertText, 'uuid-1');
			assert.strictEqual(result[0].filterText, 'Alpha');
		} finally {
			restore();
		}
	});

	test('org has no indexed templates yet → empty array, not undefined', () => {
		LinkManager.addLink(makeTemplateLink(uri, 'org-1', 'Org 1'));
		const line = 'template("';
		const doc = makeDoc(uri, line);
		const result = provider.provideCompletionItems(
			doc,
			new vscode.Position(0, line.length),
			dummyToken,
			dummyContext,
		);
		assert.deepStrictEqual(result, []);
	});
});
