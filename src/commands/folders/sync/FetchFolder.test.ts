import { FolderLink, LinkManager } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { FetchFolder } from './FetchFolder';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: FetchFolder', () => {
	let tmpDir: string;
	let folderUri: vscode.Uri;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-fetch-folder-'));
		folderUri = vscode.Uri.file(tmpDir);
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('fetches missing templates into the previously linked folder', async () => {
		const org = Fixtures.orgModel({ id: 'org-fetch-cmd', name: 'Fetch Cmd Org' });
		const folderLink: FolderLink = { type: 'Folder', uriString: folderUri.toString(), org };
		LinkManager.addLink(folderLink);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't1', name: 'Solo', orgId: org.id })]),
		});
		wrapper.when('getTemplate', () => ({
			data: Fixtures.getTemplateQuery({
				id: 't1',
				name: 'Solo',
				body: 'solo-body',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		}));
		SessionManager._setSessionsForTesting([session]);

		await new FetchFolder().execute([folderUri]);

		const links = LinkManager.getOrgTemplateLinks(org);
		assert.strictEqual(links.length, 1);
		assert.strictEqual(fs.readFileSync(vscode.Uri.parse(links[0].uriString).fsPath, 'utf8'), 'solo-body');
	});

	// Documents current behavior: getFolderLink() is resolved before the
	// try/catch in FetchFolder.execute, so an unlinked folder rejects instead
	// of being caught and surfaced via log.notifyError like a failed fetch is.
	// See notesForReviewer.
	test('rejects when run against a folder that was never linked', async () => {
		await assert.rejects(() => new FetchFolder().execute([folderUri]), /Could not find link/);
	});
});
