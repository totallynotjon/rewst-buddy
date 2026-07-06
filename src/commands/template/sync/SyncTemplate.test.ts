import { LinkManager, SyncManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment, stub } from '@test';
import { getHash, log } from '@utils';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { SyncTemplate } from './SyncTemplate';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: SyncTemplate', () => {
	let tmpDir: string;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-sync-template-'));
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncManager._resetConflictDepsForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('dismissing a conflict is a clean no-op, not a scary error notification', async () => {
		const uri = vscode.Uri.file(path.join(tmpDir, 'conflict.txt'));
		fs.writeFileSync(uri.fsPath, '// locally edited content');
		const templateId = 'template-sync-command-conflict';
		const org = Fixtures.orgModel({ id: 'org-sync-command-conflict', name: 'Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: templateId, name: 'T', updatedAt: 'local-ts' } as any,
			bodyHash: getHash('// prior synced content'),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'T',
				body: '// remote content, different from local',
				updatedAt: 'remote-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		SyncManager._setConflictDepsForTesting({
			showDiff: async () => vscode.Uri.file('/test/fake-remote'),
			promptChoice: async () => undefined,
			closeDiff: async () => {},
		});

		let notifyErrorCalls = 0;
		const restoreError = stub(log, 'notifyError', ((message: string) => {
			notifyErrorCalls++;
			return new Error(message);
		}) as typeof log.notifyError);
		let notifyInfoCalls = 0;
		const restoreInfo = stub(log, 'notifyInfo', (() => {
			notifyInfoCalls++;
		}) as typeof log.notifyInfo);

		try {
			await new SyncTemplate().execute([uri]);
		} finally {
			restoreError();
			restoreInfo();
		}

		assert.strictEqual(notifyErrorCalls, 0, 'a dismissed conflict is a clean abort, not an error notification');
		assert.strictEqual(notifyInfoCalls, 0, 'a dismissed conflict did not succeed either');
	});
});
