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
suite('Unit: openTemplateById', () => {
	const opened: string[] = [];
	let restore: (() => void) | undefined;

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		opened.length = 0;

		const original = vscode.commands.executeCommand;
		Object.defineProperty(vscode.commands, 'executeCommand', {
			value: (async (command: string, uri?: vscode.Uri) => {
				if (command === 'vscode.open' && uri) opened.push(uri.toString());
				return undefined;
			}) as typeof vscode.commands.executeCommand,
			configurable: true,
			writable: true,
		});
		restore = () =>
			Object.defineProperty(vscode.commands, 'executeCommand', {
				value: original,
				configurable: true,
				writable: true,
			});
	});

	teardown(() => {
		restore?.();
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
});
