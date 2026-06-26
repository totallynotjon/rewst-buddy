import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { initTestEnvironment } from '@test';
import { LinkManager, type TemplateLink } from '@models';
import { openTemplateById } from './openTemplateById';

const { suite, test, setup, teardown } = Mocha;

/**
 * openTemplateById is the reverse lookup that surfaced the #90 staleness to the
 * user (ctrl-click a template() reference / open-by-id). It had no coverage, so
 * a stale templateIdIndex entry would silently open the wrong file. These tests
 * stub vscode.open to record which uri (if any) is opened.
 */
interface QuickPickItemWithLink {
	link: TemplateLink;
}

suite('Unit: openTemplateById', () => {
	const opened: string[] = [];
	const restores: (() => void)[] = [];
	// Resolves the QuickPick shown when several files share a template id; default
	// returns undefined (the user cancelled).
	let pickResolver: (items: readonly QuickPickItemWithLink[]) => QuickPickItemWithLink | undefined = () => undefined;

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		opened.length = 0;
		pickResolver = () => undefined;

		stub(vscode.commands, 'executeCommand', (async (command: string, uri?: vscode.Uri) => {
			if (command === 'vscode.open' && uri) opened.push(uri.toString());
			return undefined;
		}) as typeof vscode.commands.executeCommand);

		stub(vscode.window, 'showQuickPick', (async (items: readonly QuickPickItemWithLink[]) =>
			pickResolver(items)) as unknown as typeof vscode.window.showQuickPick);
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		LinkManager._resetForTesting();
	});

	function link(path: string, templateId: string): TemplateLink {
		return {
			uriString: vscode.Uri.file(path).toString(),
			org: { id: 'org-1', name: 'Org One' },
			type: 'Template',
			template: { id: templateId, name: templateId, updatedAt: '' } as TemplateLink['template'],
			bodyHash: 'h',
		};
	}

	test('returns null and opens nothing for an unknown template id', async () => {
		assert.strictEqual(await openTemplateById('missing'), null);
		assert.deepStrictEqual(opened, []);
	});

	test('opens the linked file for a known template id', async () => {
		const uri = vscode.Uri.file('/ws/a.j2');
		LinkManager.addLink(link('/ws/a.j2', 'tpl-1'));

		const result = await openTemplateById('tpl-1');
		assert.ok(result);
		assert.strictEqual(result.template.id, 'tpl-1');
		assert.deepStrictEqual(opened, [uri.toString()]);
	});

	test('after re-linking a file to a different template, the old id no longer opens it (#90)', async () => {
		const uri = vscode.Uri.file('/ws/page.j2');
		LinkManager.addLink(link('/ws/page.j2', 'tpl-old'));
		LinkManager.addLink(link('/ws/page.j2', 'tpl-new'));

		assert.strictEqual(await openTemplateById('tpl-old'), null, 'stale template id opens nothing');
		assert.deepStrictEqual(opened, [], 'no stale file was opened');

		const result = await openTemplateById('tpl-new');
		assert.ok(result);
		assert.strictEqual(result.template.id, 'tpl-new');
		assert.deepStrictEqual(opened, [uri.toString()]);
	});

	test('prompts with a QuickPick when several files share a template id and opens the chosen one', async () => {
		const wanted = vscode.Uri.file('/ws/second.j2');
		LinkManager.addLink(link('/ws/first.j2', 'shared'));
		LinkManager.addLink(link('/ws/second.j2', 'shared'));
		pickResolver = items => items.find(item => item.link.uriString === wanted.toString());

		const result = await openTemplateById('shared');
		assert.ok(result);
		assert.strictEqual(result.uriString, wanted.toString());
		assert.deepStrictEqual(opened, [wanted.toString()]);
	});

	test('returns null and opens nothing when the multi-link QuickPick is cancelled', async () => {
		LinkManager.addLink(link('/ws/first.j2', 'shared'));
		LinkManager.addLink(link('/ws/second.j2', 'shared'));
		pickResolver = () => undefined; // user dismissed the picker

		assert.strictEqual(await openTemplateById('shared'), null);
		assert.deepStrictEqual(opened, []);
	});
});
