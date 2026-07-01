import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { OpenTemplateFromURL } from './OpenTemplateFromURL';

const { suite, test, setup, teardown } = Mocha;

/**
 * OpenTemplateFromURL drives the "Open or link a template from its Rewst
 * URL" flow for opening: parse the URL, reuse an existing local link if one
 * exists, otherwise resolve a session and fetch+link the template. These
 * tests only exercise the primary-org-match path of session resolution (see
 * the template-management spec's managed-sub-org implementation-status
 * note); the mock session's default region loginUrl is
 * http://localhost:9999/login, so URLs below use that host.
 */
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const templateURL = `http://localhost:9999/organizations/${ORG_ID}/templates/${TEMPLATE_ID}`;

suite('Unit: OpenTemplateFromURL', () => {
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	function stubURLInput(value: string | undefined): void {
		stub(vscode.window, 'showInputBox', (async () => value) as unknown as typeof vscode.window.showInputBox);
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
		// Runs after restores, so this hits the real command even for tests that
		// stubbed executeCommand — disposes any untitled editor a test opened,
		// even if an assertion failed before the test reached its own cleanup.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('reuses an existing local link instead of fetching a duplicate', async () => {
		const uri = vscode.Uri.file('/ws/already-open.j2');
		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: ORG_ID, name: 'Org One' },
			template: { id: TEMPLATE_ID, name: 'Existing', updatedAt: '' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(link);
		stubURLInput(templateURL);

		const opened: string[] = [];
		stub(vscode.commands, 'executeCommand', (async (command: string, openUri?: vscode.Uri) => {
			if (command === 'vscode.open' && openUri) opened.push(openUri.toString());
			return undefined;
		}) as typeof vscode.commands.executeCommand);

		await new OpenTemplateFromURL().execute();

		assert.deepStrictEqual(opened, [uri.toString()]);
	});

	test('fetches the full template, prompts a save location, and links a new file when no link exists', async () => {
		const org = Fixtures.orgModel({ id: ORG_ID, name: 'Org One' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: TEMPLATE_ID,
				orgId: ORG_ID,
				organization: Fixtures.org({ id: ORG_ID, name: 'Org One' }),
				body: 'fetched body',
			}),
		});
		SessionManager._setSessionsForTesting([session]);
		stubURLInput(templateURL);

		const fixedUri = vscode.Uri.file('/ws/new-from-url.j2');
		stub(vscode.workspace, 'saveAs', (async () => fixedUri) as typeof vscode.workspace.saveAs);

		await new OpenTemplateFromURL().execute();

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);
		assert.strictEqual(LinkManager.isLinked(fixedUri), true);
		const link = LinkManager.getTemplateLink(fixedUri);
		assert.strictEqual(link.template.id, TEMPLATE_ID);
		assert.strictEqual(link.org.id, ORG_ID);
	});

	test('does nothing when the user cancels the URL prompt', async () => {
		stubURLInput(undefined);

		await assert.rejects(() => new OpenTemplateFromURL().execute(), /not a string/);
	});
});
