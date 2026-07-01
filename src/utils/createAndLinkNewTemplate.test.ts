import { LinkManager } from '@models';
import { FullTemplateFragment } from '@sessions';
import { Fixtures, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { createAndLinkNewTemplate } from './createAndLinkNewTemplate';
import { getHash } from './getHash';

const { suite, test, setup, teardown } = Mocha;

/**
 * createAndLinkNewTemplate is the "Template not yet linked" flow shared by
 * OpenTemplateFromURL and OpenTemplateInteractive: it opens an untitled
 * document seeded with the fetched template body, prompts the user to save,
 * and links the saved file. Everything except vscode.workspace.saveAs runs
 * for real against the test extension host (untitled document creation,
 * showTextDocument, edit) since that is cheap and exercises the real flow.
 */
suite('Unit: createAndLinkNewTemplate', () => {
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
	});

	teardown(async () => {
		while (restores.length) restores.pop()!();
		LinkManager._resetForTesting();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	function makeTemplate(overrides?: Partial<FullTemplateFragment>): FullTemplateFragment {
		return Fixtures.fullTemplate({
			id: 'tpl-new',
			name: 'Brand New',
			body: "// fetched template body\n{{ template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') }}",
			orgId: 'org-new',
			organization: Fixtures.org({ id: 'org-new', name: 'New Org' }),
			...overrides,
		});
	}

	test('saves the fetched content and links the new file', async () => {
		const template = makeTemplate();
		const content = template.body;
		const fixedUri = vscode.Uri.file('/ws/new-from-template.j2');
		stub(vscode.workspace, 'saveAs', (async () => fixedUri) as typeof vscode.workspace.saveAs);

		const result = await createAndLinkNewTemplate(template);

		assert.strictEqual(result, true);
		assert.strictEqual(LinkManager.isLinked(fixedUri), true);
		const link = LinkManager.getTemplateLink(fixedUri);
		assert.strictEqual(link.template.id, 'tpl-new');
		assert.strictEqual(link.bodyHash, getHash(content), 'hash reflects the original fetched body');
		assert.strictEqual(link.org.id, 'org-new');
		assert.strictEqual(link.org.name, 'New Org');
		assert.deepStrictEqual(link.referencedTemplateIds, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
	});

	test('returns false and links nothing when the user cancels the save dialog', async () => {
		const template = makeTemplate({ id: 'tpl-cancelled', orgId: 'org-cancel' });
		stub(vscode.workspace, 'saveAs', (async () => undefined) as typeof vscode.workspace.saveAs);

		const result = await createAndLinkNewTemplate(template);

		assert.strictEqual(result, false);
		assert.deepStrictEqual(LinkManager.getTemplateLinkFromId('tpl-cancelled'), []);
	});
});
