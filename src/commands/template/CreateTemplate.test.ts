import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import { getHash } from '@utils';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { CreateTemplate } from './CreateTemplate';

const { suite, test, setup, teardown } = Mocha;

/**
 * CreateTemplate drives the "Create a template from a local file" flow:
 * refuse-if-linked, pickOrganization (session -> primary/other org QuickPicks),
 * a name InputBox defaulting to the file's base name, then createTemplateMinimal
 * + a new local link. These tests stub vscode.window.showQuickPick/showInputBox
 * using the Object.defineProperty stub()/restore() pattern from
 * src/utils/openTemplateById.test.ts and use real saved files on disk, since
 * ensureSavedDocument() opens documents via the real vscode.workspace API.
 */
interface OrgQuickPickItem {
	arguments: unknown[];
}

suite('Unit: CreateTemplate', () => {
	let tmpDir: string;
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	function stubPrimaryOrgQuickPick(): void {
		stub(vscode.window, 'showQuickPick', (async (items: readonly OrgQuickPickItem[]) =>
			items.find(i => 'arguments' in i)) as unknown as typeof vscode.window.showQuickPick);
	}

	function stubInputBox(value: string | undefined): void {
		stub(vscode.window, 'showInputBox', (async () => value) as unknown as typeof vscode.window.showInputBox);
	}

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-create-template-'));
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

	test('creates the template in Rewst from the file body and links the file', async () => {
		const body = '// new template body';
		const uri = writeFile('my-template.j2', body);

		const org = Fixtures.orgModel({ id: 'org-create', name: 'Create Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		const createdId = 'tpl-created';
		wrapper.when('createTemplateMinimal', vars => ({
			data: Fixtures.createTemplateMinimalMutation({
				id: createdId,
				name: vars.name,
				orgId: vars.orgId,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		}));

		SessionManager._setSessionsForTesting([session]);
		stubPrimaryOrgQuickPick();
		stubInputBox('my-template'); // defaults to file base name, but confirm explicit value works too

		await new CreateTemplate().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), true);
		const link = LinkManager.getTemplateLink(uri);
		assert.strictEqual(link.template.id, createdId);
		assert.strictEqual(link.bodyHash, getHash(body));
		assert.strictEqual(link.org.id, org.id);

		const calls = wrapper.getCallsFor('createTemplateMinimal');
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].variables.name, 'my-template');
		assert.strictEqual(calls[0].variables.orgId, org.id);
		assert.strictEqual(calls[0].variables.body, body);
	});

	test('refuses to create a template when the file is already linked', async () => {
		const uri = writeFile('already-linked.j2', 'body');
		const existingLink: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: 'org-1', name: 'Org One' },
			template: { id: 'tpl-existing', name: 'Existing', updatedAt: '', orgId: 'org-1' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(existingLink);

		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org One' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);

		await assert.rejects(() => new CreateTemplate().execute([uri]), /Already linked/);

		assert.strictEqual(wrapper.getCallsFor('createTemplateMinimal').length, 0, 'no template should be created');
	});

	test('does nothing when the user cancels org selection', async () => {
		const uri = writeFile('cancel-org.j2', 'body');
		const org = Fixtures.orgModel({ id: 'org-2', name: 'Org Two' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);

		stub(vscode.window, 'showQuickPick', (async () => undefined) as unknown as typeof vscode.window.showQuickPick);

		await new CreateTemplate().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), false);
		assert.strictEqual(wrapper.getCallsFor('createTemplateMinimal').length, 0);
	});

	test('does nothing when the user cancels the name prompt', async () => {
		const uri = writeFile('cancel-name.j2', 'body');
		const org = Fixtures.orgModel({ id: 'org-3', name: 'Org Three' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);

		stubPrimaryOrgQuickPick();
		stubInputBox(undefined);

		await new CreateTemplate().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), false);
		assert.strictEqual(wrapper.getCallsFor('createTemplateMinimal').length, 0);
	});
});
