import { LinkManager, SyncOnSaveManager, TemplateLink } from '@models';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { EnableSyncOnSave } from './EnableSyncOnSave';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: EnableSyncOnSave', () => {
	let tmpDir: string;

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-enable-sync-'));
	});

	teardown(() => {
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function linkedFile(name: string): vscode.Uri {
		const filePath = path.join(tmpDir, name);
		fs.writeFileSync(filePath, 'content');
		const uri = vscode.Uri.file(filePath);
		const link: TemplateLink = {
			uriString: uri.toString(),
			org: { id: 'org-1', name: 'Org' },
			type: 'Template',
			template: { id: 'tpl-1', name: 'Tpl', updatedAt: '' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(link);
		return uri;
	}

	test('turns sync-on-save on for a linked file', async () => {
		const uri = linkedFile('a.j2');
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false);

		await new EnableSyncOnSave().execute([uri]);

		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), true);
	});

	test('is a no-op when sync-on-save is already enabled', async () => {
		const uri = linkedFile('b.j2');
		SyncOnSaveManager.enableSync(uri);

		await new EnableSyncOnSave().execute([uri]);

		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), true, 'remains enabled');
	});
});
