import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { OpenTemplateInteractive } from './OpenTemplateInteractive';

const { suite, test, setup, teardown } = Mocha;

/**
 * OpenTemplateInteractive drives the "Open a template, reusing an existing
 * link" requirement interactively: pickTemplate (session -> org -> template
 * QuickPicks), then reuse an existing local link or fetch+link a new file.
 * These tests stub vscode.window.showQuickPick using the
 * Object.defineProperty stub()/restore() pattern from
 * src/utils/openTemplateById.test.ts.
 */
interface OrgQuickPickItem {
	arguments: unknown[];
}
interface TemplateQuickPickItem {
	template: { id: string };
}

suite('Unit: OpenTemplateInteractive', () => {
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	function stubPickFlow(pickTemplateId?: string): void {
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
	});

	teardown(async () => {
		while (restores.length) restores.pop()!();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('opens the existing local file instead of fetching a duplicate', async () => {
		const org = Fixtures.orgModel({ id: 'org-open', name: 'Open Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		const templateId = 'tpl-already-open';
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery([
				Fixtures.template({ id: templateId, name: 'Already Open', orgId: org.id }),
			]),
		});
		SessionManager._setSessionsForTesting([session]);

		const uri = vscode.Uri.file('/ws/already-open.j2');
		const existingLink: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: org.id, name: org.name },
			template: { id: templateId, name: 'Already Open', updatedAt: '' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(existingLink);

		stubPickFlow(templateId);

		const opened: string[] = [];
		stub(vscode.commands, 'executeCommand', (async (command: string, openUri?: vscode.Uri) => {
			if (command === 'vscode.open' && openUri) opened.push(openUri.toString());
			return undefined;
		}) as typeof vscode.commands.executeCommand);

		await new OpenTemplateInteractive().execute();

		assert.deepStrictEqual(opened, [uri.toString()]);
		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 0, 'must not fetch the full template');
	});

	test('fetches the full template, prompts a save location, and links a new file when no link exists', async () => {
		const org = Fixtures.orgModel({ id: 'org-fetch', name: 'Fetch Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		const templateId = 'tpl-new';
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery([
				Fixtures.template({ id: templateId, name: 'New Template', orgId: org.id }),
			]),
		});
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
				body: 'fetched body',
			}),
		});
		SessionManager._setSessionsForTesting([session]);
		stubPickFlow(templateId);

		const fixedUri = vscode.Uri.file('/ws/interactive-new.j2');
		stub(vscode.workspace, 'saveAs', (async () => fixedUri) as typeof vscode.workspace.saveAs);

		await new OpenTemplateInteractive().execute();

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);
		assert.strictEqual(LinkManager.isLinked(fixedUri), true);
		const link = LinkManager.getTemplateLink(fixedUri);
		assert.strictEqual(link.template.id, templateId);
	});

	test('does nothing when the user cancels template selection', async () => {
		const org = Fixtures.orgModel({ id: 'org-cancel', name: 'Cancel Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery([
				Fixtures.template({ id: 'tpl-x', name: 'Some Template', orgId: org.id }),
			]),
		});
		SessionManager._setSessionsForTesting([session]);
		stubPickFlow(undefined);

		await new OpenTemplateInteractive().execute();

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 0);
	});
});
