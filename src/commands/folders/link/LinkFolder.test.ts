import { LinkManager, SyncManager } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { LinkFolder } from './LinkFolder';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: LinkFolder', () => {
	let tmpDir: string;
	let folderUri: vscode.Uri;
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-link-folder-'));
		folderUri = vscode.Uri.file(tmpDir);
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('links the folder to the chosen org and fetches its templates', async () => {
		const org = Fixtures.orgModel({ id: 'org-link-folder', name: 'Folder Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't1', name: 'Alpha', orgId: org.id })]),
		});
		wrapper.when('getTemplate', () => ({
			data: Fixtures.getTemplateQuery({
				id: 't1',
				name: 'Alpha',
				body: 'alpha-body',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		}));
		SessionManager._setSessionsForTesting([session]);

		stub(vscode.window, 'showQuickPick', (async (items: readonly { detail?: string }[]) =>
			items.find(i => i.detail === 'Primary Organization')) as unknown as typeof vscode.window.showQuickPick);

		await new LinkFolder().execute([folderUri]);

		const folderLink = LinkManager.getFolderLink(folderUri);
		assert.strictEqual(folderLink.org.id, org.id);

		const templateLinks = LinkManager.getOrgTemplateLinks(org);
		assert.strictEqual(templateLinks.length, 1);
		const filePath = vscode.Uri.parse(templateLinks[0].uriString).fsPath;
		assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'alpha-body');
	});

	test('does not link the folder when org selection is cancelled', async () => {
		const org = Fixtures.orgModel({ id: 'org-cancel', name: 'Cancel Org' });
		const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);

		stub(vscode.window, 'showQuickPick', (async () => undefined) as unknown as typeof vscode.window.showQuickPick);

		await new LinkFolder().execute([folderUri]);

		assert.strictEqual(LinkManager.getFolderLinks().length, 0);
	});

	test('still links the folder when fetching its templates fails', async () => {
		const org = Fixtures.orgModel({ id: 'org-fetch-fail', name: 'Fetch Fail Org' });
		const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);

		stub(vscode.window, 'showQuickPick', (async (items: readonly { detail?: string }[]) =>
			items.find(i => i.detail === 'Primary Organization')) as unknown as typeof vscode.window.showQuickPick);

		let fetchCalled = false;
		stub(SyncManager, 'fetchFolder', (async () => {
			fetchCalled = true;
			throw new Error('fetch failed');
		}) as typeof SyncManager.fetchFolder);

		await new LinkFolder().execute([folderUri]);

		assert.ok(fetchCalled, 'the folder fetch was attempted');
		const folderLink = LinkManager.getFolderLink(folderUri);
		assert.strictEqual(folderLink.org.id, org.id, 'the folder link persists despite the fetch failure');
	});
});
