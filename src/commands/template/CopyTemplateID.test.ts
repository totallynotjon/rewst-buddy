import { LinkManager, TemplateLink } from '@models';
import { initTestEnvironment, stub } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { CopyTemplateID } from './CopyTemplateID';

const { suite, test, setup, teardown } = Mocha;

/**
 * CopyTemplateID drives the "Copy a linked template's id" requirement:
 * resolve the file (context menu uri or active editor), look up its link,
 * and write the template id to the clipboard.
 */
suite('Unit: CopyTemplateID', () => {
	let tmpDir: string;
	let clipboardText: string;
	let restoreClipboard: () => void;

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-copy-id-'));
		// Stub the clipboard: the real vscode.env.clipboard is the SYSTEM
		// clipboard, so anything the user copies mid-run makes these flaky.
		clipboardText = '';
		restoreClipboard = stub(vscode.env, 'clipboard', {
			writeText: async (text: string) => {
				clipboardText = text;
			},
			readText: async () => clipboardText,
		});
	});

	teardown(() => {
		restoreClipboard();
		LinkManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeFile(name: string, content: string): vscode.Uri {
		const filePath = path.join(tmpDir, name);
		fs.writeFileSync(filePath, content);
		return vscode.Uri.file(filePath);
	}

	function linkFile(uri: vscode.Uri, templateId: string): TemplateLink {
		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: 'org-1', name: 'Org One' },
			template: { id: templateId, name: 'Linked Template', updatedAt: '' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(link);
		return link;
	}

	test('copies the template id from a context-menu uri', async () => {
		const uri = writeFile('context-menu.j2', 'body');
		linkFile(uri, 'tpl-context-menu');

		await new CopyTemplateID().execute([uri]);

		assert.strictEqual(await vscode.env.clipboard.readText(), 'tpl-context-menu');
	});

	test('copies the template id from the active editor when no uri arg is given', async () => {
		const uri = writeFile('active-editor.j2', 'body');
		linkFile(uri, 'tpl-active-editor');

		// Stub activeTextEditor directly rather than relying on showTextDocument to
		// actually grant focus -- unreliable in a headless Extension Host,
		// especially as part of a large suite (see OpenInRewst.test.ts for the
		// same pattern).
		const document = await vscode.workspace.openTextDocument(uri);
		const original = vscode.window.activeTextEditor;
		Object.defineProperty(vscode.window, 'activeTextEditor', {
			value: { document },
			configurable: true,
		});

		try {
			await new CopyTemplateID().execute();
			assert.strictEqual(await vscode.env.clipboard.readText(), 'tpl-active-editor');
		} finally {
			Object.defineProperty(vscode.window, 'activeTextEditor', {
				value: original,
				configurable: true,
			});
		}
	});

	test('does not throw and leaves the clipboard untouched when the file is not linked', async () => {
		const uri = writeFile('unlinked.j2', 'body');
		await vscode.env.clipboard.writeText('unchanged');

		await new CopyTemplateID().execute([uri]);

		assert.strictEqual(await vscode.env.clipboard.readText(), 'unchanged');
	});
});
