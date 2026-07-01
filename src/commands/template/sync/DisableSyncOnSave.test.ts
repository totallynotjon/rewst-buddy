import { LinkManager, SyncOnSaveManager, TemplateLink } from '@models';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { DisableSyncOnSave } from './DisableSyncOnSave';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: DisableSyncOnSave', () => {
	let tmpDir: string;

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-disable-sync-'));
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

	test('turns sync-on-save off for a linked file that was enabled', async () => {
		const uri = linkedFile('a.j2');
		SyncOnSaveManager.enableSync(uri);
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), true);

		await new DisableSyncOnSave().execute([uri]);

		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false);
	});

	test('is a no-op when sync-on-save is not enabled', async () => {
		const uri = linkedFile('b.j2');
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false);

		await new DisableSyncOnSave().execute([uri]);

		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false, 'remains disabled');
	});

	test('with the default enabled, disabling a file excludes only that file', async () => {
		SyncOnSaveManager.syncByDefault = true;
		const uri = linkedFile('c.j2');
		const other = linkedFile('d.j2');

		await new DisableSyncOnSave().execute([uri]);

		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false);
		assert.strictEqual(SyncOnSaveManager.isUriSynced(other), true, 'unrelated linked file still syncs');
	});
});
