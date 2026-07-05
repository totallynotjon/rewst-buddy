import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment, stub } from '@test';
import { log } from '@utils';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { DiffAgainstRewst } from './DiffAgainstRewst';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: DiffAgainstRewst', () => {
	let tmpDir: string;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-diff-against-'));
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeFile(name: string, content: string): vscode.Uri {
		const filePath = path.join(tmpDir, name);
		fs.writeFileSync(filePath, content);
		return vscode.Uri.file(filePath);
	}

	function linkFile(uri: vscode.Uri, orgId: string, templateId: string): TemplateLink {
		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: orgId, name: 'Org One' },
			template: { id: templateId, name: 'Linked Template', updatedAt: '' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(link);
		return link;
	}

	test('opens a diff for a linked file against its current remote body', async () => {
		const uri = writeFile('linked.j2', 'local body');
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org One' });
		linkFile(uri, org.id, 'tpl-1');

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: 'tpl-1',
				body: 'remote body',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		let diffArgs: unknown[] | undefined;
		const restore = stub(vscode.commands, 'executeCommand', (async (...args: unknown[]) => {
			diffArgs = args;
			return undefined;
		}) as typeof vscode.commands.executeCommand);

		try {
			await new DiffAgainstRewst().execute([uri]);
		} finally {
			restore();
		}

		assert.ok(diffArgs, 'expected vscode.diff to have been invoked');
		assert.strictEqual(diffArgs![0], 'vscode.diff');
		assert.strictEqual((diffArgs![1] as vscode.Uri).toString(), uri.toString());
		assert.ok((diffArgs![2] as vscode.Uri).toString().startsWith('rewst-remote:'));
		assert.ok(String(diffArgs![3]).includes('linked.j2'));
	});

	test('notifies an error when the file is not linked', async () => {
		const uri = writeFile('unlinked.j2', 'local body');

		let notifyCalls = 0;
		const restoreNotify = stub(log, 'notifyError', ((message: string) => {
			notifyCalls++;
			return new Error(message);
		}) as typeof log.notifyError);
		let diffCalled = false;
		const restoreExec = stub(vscode.commands, 'executeCommand', (async (...args: unknown[]) => {
			if (args[0] === 'vscode.diff') diffCalled = true;
			return undefined;
		}) as typeof vscode.commands.executeCommand);

		try {
			await new DiffAgainstRewst().execute([uri]);
		} finally {
			restoreNotify();
			restoreExec();
		}

		assert.strictEqual(notifyCalls, 1);
		assert.strictEqual(diffCalled, false);
	});

	test('notifies an error when the remote fetch fails', async () => {
		const uri = writeFile('linked.j2', 'local body');
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org One' });
		linkFile(uri, org.id, 'tpl-1');

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', { error: Fixtures.networkError('engine unavailable') });
		SessionManager._setSessionsForTesting([session]);

		let notifyCalls = 0;
		const restoreNotify = stub(log, 'notifyError', ((message: string) => {
			notifyCalls++;
			return new Error(message);
		}) as typeof log.notifyError);
		let diffCalled = false;
		const restoreExec = stub(vscode.commands, 'executeCommand', (async (...args: unknown[]) => {
			if (args[0] === 'vscode.diff') diffCalled = true;
			return undefined;
		}) as typeof vscode.commands.executeCommand);

		try {
			await new DiffAgainstRewst().execute([uri]);
		} finally {
			restoreNotify();
			restoreExec();
		}

		assert.strictEqual(notifyCalls, 1);
		assert.strictEqual(diffCalled, false);
	});
});
