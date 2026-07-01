import { FolderLink, LinkManager, TemplateLink } from '@models';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { UnlinkAllTemplates } from './UnlinkAllTemplates';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: UnlinkAllTemplates', () => {
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	function seedLinks(): { tplLink: TemplateLink; folderLink: FolderLink } {
		const tplLink: TemplateLink = {
			uriString: vscode.Uri.file('/test/a.j2').toString(),
			org: { id: 'org-1', name: 'Org' },
			type: 'Template',
			template: { id: 'tpl-1', name: 'Tpl', updatedAt: '' } as any,
			bodyHash: 'hash',
		};
		const folderLink: FolderLink = {
			uriString: vscode.Uri.file('/test/folder').toString(),
			org: { id: 'org-1', name: 'Org' },
			type: 'Folder',
		};
		LinkManager.addLink(tplLink);
		LinkManager.addLink(folderLink);
		return { tplLink, folderLink };
	}

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		LinkManager._resetForTesting();
	});

	test('clears all template links when the user confirms', async () => {
		const { tplLink, folderLink } = seedLinks();
		stub(
			vscode.window,
			'showInformationMessage',
			(async () => 'Clear Links') as unknown as typeof vscode.window.showInformationMessage,
		);

		await new UnlinkAllTemplates().execute();

		assert.strictEqual(LinkManager.isLinked(vscode.Uri.parse(tplLink.uriString)), false);
		assert.strictEqual(
			LinkManager.isLinked(vscode.Uri.parse(folderLink.uriString)),
			true,
			'folder links are untouched',
		);
	});

	test('leaves links untouched when the user dismisses the confirmation', async () => {
		const { tplLink } = seedLinks();
		stub(
			vscode.window,
			'showInformationMessage',
			(async () => undefined) as unknown as typeof vscode.window.showInformationMessage,
		);

		await new UnlinkAllTemplates().execute();

		assert.strictEqual(
			LinkManager.isLinked(vscode.Uri.parse(tplLink.uriString)),
			true,
			'link should remain when the confirmation is dismissed',
		);
	});
});
