import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { DeleteTemplate } from './DeleteTemplate';

const { suite, test, setup, teardown } = Mocha;

/**
 * DeleteTemplate drives the "Delete a template with confirmation" flow: a
 * modal warning confirmation, then deleteTemplate over the SDK, then removal
 * of the local link. This test stubs vscode.window.showWarningMessage using
 * the Object.defineProperty stub()/restore() pattern from
 * src/utils/openTemplateById.test.ts.
 */
suite('Unit: DeleteTemplate', () => {
	let tmpDir: string;
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	function stubConfirm(response: 'Delete' | undefined): void {
		stub(
			vscode.window,
			'showWarningMessage',
			(async () => response) as unknown as typeof vscode.window.showWarningMessage,
		);
	}

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-delete-template-'));
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeFile(name: string, content: string): vscode.Uri {
		const filePath = path.join(tmpDir, name);
		fs.writeFileSync(filePath, content);
		return vscode.Uri.file(filePath);
	}

	function linkFile(uri: vscode.Uri, org: { id: string; name: string }, templateId: string): TemplateLink {
		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: {
				id: templateId,
				name: 'Doomed Template',
				updatedAt: '',
				orgId: org.id,
				organization: org,
			} as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(link);
		return link;
	}

	test('deletes the template in Rewst and removes the local link when the user confirms', async () => {
		const uri = writeFile('confirm.j2', 'body');
		const org = Fixtures.orgModel({ id: 'org-del', name: 'Delete Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		const templateId = 'tpl-to-delete';
		linkFile(uri, org, templateId);

		wrapper.when('deleteTemplate', { data: { __typename: 'Mutation', deleteTemplate: templateId } });
		SessionManager._setSessionsForTesting([session]);
		stubConfirm('Delete');

		await new DeleteTemplate().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), false, 'link should be removed after a successful delete');
		const calls = wrapper.getCallsFor('deleteTemplate');
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].variables.id, templateId);
	});

	test('deletes nothing and keeps the link when the user dismisses the confirmation', async () => {
		const uri = writeFile('cancel.j2', 'body');
		const org = Fixtures.orgModel({ id: 'org-del-2', name: 'Delete Org Two' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		const templateId = 'tpl-keep';
		linkFile(uri, org, templateId);

		SessionManager._setSessionsForTesting([session]);
		stubConfirm(undefined);

		await new DeleteTemplate().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), true, 'link should remain when the user cancels');
		assert.strictEqual(wrapper.getCallsFor('deleteTemplate').length, 0, 'no delete call should be made');
	});

	test('throws when the file has no template link', async () => {
		const uri = writeFile('unlinked.j2', 'body');
		await assert.rejects(() => new DeleteTemplate().execute([uri]), /no template linked/);
	});
});
