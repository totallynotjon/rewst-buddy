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
import { LinkTemplateInteractive } from './LinkTemplateInteractive';

const { suite, test, setup, teardown } = Mocha;

/**
 * LinkTemplateInteractive drives the full "Link File to Template" user flow:
 * refuse-if-linked, pickTemplate (session -> org -> template QuickPicks),
 * fetch the template, record the link, then sync. These tests stub
 * vscode.window.showQuickPick using the Object.defineProperty stub()/restore()
 * pattern from src/utils/openTemplateById.test.ts and use real saved files on
 * disk, since ensureSavedDocument() opens documents via vscode.workspace
 * (real, not mocked, in this test host).
 */
interface OrgQuickPickItem {
	arguments: unknown[];
}
interface TemplateQuickPickItem {
	template: { id: string };
}

suite('Unit: LinkTemplateInteractive', () => {
	let tmpDir: string;
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	function stubQuickPick(pickTemplateId?: string): void {
		stub(vscode.window, 'showQuickPick', (async (items: readonly (OrgQuickPickItem | TemplateQuickPickItem)[]) => {
			const orgItem = items.find((i): i is OrgQuickPickItem => 'arguments' in i);
			if (orgItem) return orgItem; // always pick "Primary Organization"
			if (!pickTemplateId) return undefined; // simulate the user cancelling template selection
			return items.find((i): i is TemplateQuickPickItem => 'template' in i && i.template.id === pickTemplateId);
		}) as unknown as typeof vscode.window.showQuickPick);
	}

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-link-interactive-'));
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

	test('refuses before template selection when the file is already linked', async () => {
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

		await assert.rejects(() => new LinkTemplateInteractive().execute([uri]), /Already linked/);

		assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 0, 'template selection must not have started');
	});

	test('user links an open file: records template metadata, org, bodyHash and syncs', async () => {
		const body = '// shared body content';
		const uri = writeFile('new-link.j2', body);

		const org = Fixtures.orgModel({ id: 'org-2', name: 'Org Two' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });

		const templateId = 'tpl-target';
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery([
				Fixtures.template({ id: templateId, name: 'Target Template', orgId: org.id }),
			]),
		});
		wrapper.when('getTemplate', () => ({
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Target Template',
				body,
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		}));

		SessionManager._setSessionsForTesting([session]);
		stubQuickPick(templateId);

		await new LinkTemplateInteractive().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), true);
		const link = LinkManager.getTemplateLink(uri);
		assert.strictEqual(link.template.id, templateId);
		assert.strictEqual(link.bodyHash, getHash(body), 'bodyHash reflects the file content at link time');
		assert.strictEqual(link.org.id, org.id);
		assert.deepStrictEqual(link.referencedTemplateIds, []);

		assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 1);
		assert.strictEqual(
			wrapper.getCallsFor('getTemplate').length,
			2,
			'one fetch while linking, one fetch from the follow-up sync',
		);
	});

	test('does nothing when the user cancels template selection', async () => {
		const uri = writeFile('cancel.j2', 'body');
		const org = Fixtures.orgModel({ id: 'org-3', name: 'Org Three' });
		const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);
		stubQuickPick(undefined);

		await new LinkTemplateInteractive().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), false);
	});
});
