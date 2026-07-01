import { context } from '@global';
import { LinkManager, SyncOnSaveManager, TemplateLink } from '@models';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';

const { suite, test, setup, teardown } = Mocha;

// Spec: template-sync "Sync on save when enabled". SyncManager.handleSave only
// consults SyncOnSaveManager.isUriSynced; these tests exercise the real
// toggle/persistence logic instead of stubbing isSyncOnSaveEnabled as a constant
// (as templateSyncCapabilities.test.ts does for its own unrelated purposes).
suite('Unit: SyncOnSaveManager', () => {
	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	function linkedUri(filePath: string): vscode.Uri {
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

	test('defaults to inclusion mode: a linked file not explicitly enabled does not sync', () => {
		const uri = linkedUri('/test/a.j2');
		assert.strictEqual(SyncOnSaveManager.syncByDefault, false, 'reset state defaults to off');
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false);
	});

	test('an unlinked file never syncs, even if explicitly enabled', () => {
		const uri = vscode.Uri.file('/test/unlinked.j2');
		SyncOnSaveManager.enableSync(uri);
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false);
	});

	test('enableSync turns a linked file on and stores it in the inclusion list', () => {
		const uri = linkedUri('/test/include.j2');

		SyncOnSaveManager.enableSync(uri);

		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), true);
		const persisted = context.globalState.get<string[]>(SyncOnSaveManager.inclusionsKey, []);
		assert.ok(persisted?.includes(uri.toString()), 'inclusion is persisted to globalState');
	});

	test('per-file toggle persists across repeated checks until explicitly disabled', () => {
		const uri = linkedUri('/test/persist.j2');

		SyncOnSaveManager.enableSync(uri);
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), true, 'enabled after toggle');
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), true, 'stays enabled across repeated saves');

		SyncOnSaveManager.disableSync(uri);
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false);

		const persisted = context.globalState.get<string[]>(SyncOnSaveManager.inclusionsKey, []);
		assert.ok(!persisted?.includes(uri.toString()), 'no longer in the inclusion list once disabled');
	});

	test('default enabled with one exclusion: the excluded file does not sync while other linked files do', () => {
		SyncOnSaveManager.syncByDefault = true;
		const excluded = linkedUri('/test/excluded.j2');
		const other = linkedUri('/test/other.j2');

		SyncOnSaveManager.disableSync(excluded);

		assert.strictEqual(SyncOnSaveManager.isUriSynced(excluded), false);
		assert.strictEqual(SyncOnSaveManager.isUriSynced(other), true, 'other linked files still sync by default');

		const persistedExclusions = context.globalState.get<string[]>(SyncOnSaveManager.exclusionsKey, []);
		assert.ok(persistedExclusions?.includes(excluded.toString()), 'exclusion is persisted to globalState');
	});

	test('enableSync clears a prior exclusion; disableSync clears a prior inclusion', () => {
		const uri = linkedUri('/test/flip.j2');

		SyncOnSaveManager.disableSync(uri);
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), false);

		SyncOnSaveManager.enableSync(uri);
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), true);

		// Switching the default to exclusion-mode should not resurrect the old exclusion.
		SyncOnSaveManager.syncByDefault = true;
		assert.strictEqual(SyncOnSaveManager.isUriSynced(uri), true);
	});
});
