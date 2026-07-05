import { LinkManager, SyncManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment, stub } from '@test';
import { getHash } from '@utils';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { KeepLocalConflict } from './KeepLocalConflict';

const { suite, test, setup, teardown } = Mocha;

/**
 * KeepLocalConflict is the command bound to the "Keep Local" button on the
 * conflict diff's editor toolbar (see SyncManager's button-driven conflict
 * resolution). It has no args of its own — it just resolves whichever
 * conflict is currently pending.
 */
suite('Unit: KeepLocalConflict', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncManager._resetConflictDepsForTesting();
	});

	test('resolves a pending conflict diff as Keep Local, uploading the local body', async () => {
		const uri = vscode.Uri.file('/test/keep-local-command.txt');
		const templateId = 'template-keep-local-command';
		const org = Fixtures.orgModel({ id: 'org-keep-local-command', name: 'Org' });

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
		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'T',
				updatedAt: 'uploaded-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const doc = {
			uri,
			isUntitled: false,
			isDirty: false,
			getText: () => '// locally edited content',
			save: () => Promise.resolve(true),
		} as unknown as vscode.TextDocument;

		const restoreExec = stub(
			vscode.commands,
			'executeCommand',
			(async () => undefined) as typeof vscode.commands.executeCommand,
		);
		// The notification is a parallel resolution path alongside this command's
		// toolbar button — stub it so this test doesn't leave a real,
		// never-resolved notification open in the test extension host.
		const restoreNotification = stub(
			vscode.window,
			'showInformationMessage',
			(() => new Promise(() => {})) as unknown as typeof vscode.window.showInformationMessage,
		);

		try {
			const syncPromise = SyncManager.syncTemplate(doc);
			await new Promise(resolve => setTimeout(resolve, 0));
			await new KeepLocalConflict().execute();
			await syncPromise;
		} finally {
			restoreExec();
			restoreNotification();
		}

		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 1);
		assert.strictEqual(LinkManager.getTemplateLink(uri).template.updatedAt, 'uploaded-ts');
	});
});
