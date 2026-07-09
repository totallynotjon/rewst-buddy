import { LinkManager, SyncManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment, stub } from '@test';
import { getHash } from '@utils';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { TakeRemoteConflict } from './TakeRemoteConflict';

const { suite, test, setup, teardown } = Mocha;

/**
 * TakeRemoteConflict is the command bound to the "Take Remote" button on the
 * conflict diff's editor toolbar (see SyncManager's button-driven conflict
 * resolution). It has no args of its own — it just resolves whichever
 * conflict is currently pending.
 */
suite('Unit: TakeRemoteConflict', () => {
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

	test('resolves a pending conflict diff as Take Remote, replacing the local body', async () => {
		const uri = vscode.Uri.file('/test/take-remote-command.txt');
		const templateId = 'template-take-remote-command';
		const org = Fixtures.orgModel({ id: 'org-take-remote-command', name: 'Org' });

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

		const doc = {
			uri,
			isUntitled: false,
			isDirty: false,
			getText: () => '// locally edited content',
			save: () => Promise.resolve(true),
			lineCount: 1,
			lineAt: () => ({ range: new vscode.Range(0, 0, 0, 0) }) as unknown as vscode.TextLine,
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
		// addLink only runs after a confirmed save (#172), so stub applyEdit/save
		// to succeed — a non-open mock document's save fails for real otherwise.
		const restoreApply = stub(vscode.workspace, 'applyEdit', (async () => true) as typeof vscode.workspace.applyEdit);
		const restoreSave = stub(vscode.workspace, 'save', (async (u: vscode.Uri) => u) as typeof vscode.workspace.save);

		try {
			const syncPromise = SyncManager.syncTemplate(doc);
			await new Promise(resolve => setTimeout(resolve, 0));
			await new TakeRemoteConflict().execute();
			await syncPromise;
		} finally {
			restoreExec();
			restoreNotification();
			restoreApply();
			restoreSave();
		}

		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 0, 'no upload happens on take-remote');
		const link2 = LinkManager.getTemplateLink(uri);
		assert.strictEqual(link2.template.updatedAt, 'remote-ts');
		assert.strictEqual(link2.bodyHash, getHash('// remote content, different from local'));
	});
});
