import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';
import { LinkManager, TemplateLink, TemplateMetadataStore } from '@models';
import { SessionManager } from '@sessions';
import { TemplateDefinitionProvider } from './TemplateDefinitionProvider';

const { suite, test, setup, teardown } = Mocha;

/**
 * Covers the Ctrl+Click side of the language-navigation spec: jump straight to a
 * linked file, fetch-save-link-and-open a cached-but-unlinked template in the
 * background, and the fast "not a linked file" bail-out. TemplateDefinitionProvider
 * had zero coverage before this file.
 */
const LINKED_TEMPLATE_ID = '11111111-1111-1111-1111-111111111111';
const CACHED_TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';

function templateLink(uri: vscode.Uri, templateId: string, orgId: string, orgName: string, name: string): TemplateLink {
	return {
		uriString: uri.toString(),
		org: { id: orgId, name: orgName },
		type: 'Template',
		template: { id: templateId, name, updatedAt: '' } as TemplateLink['template'],
		bodyHash: 'hash',
	};
}

async function openDoc(content: string): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({ language: 'plaintext', content });
}

suite('Unit: TemplateDefinitionProvider', () => {
	const provider = new TemplateDefinitionProvider();
	const position = new vscode.Position(0, 5); // inside "template(" on a single-reference line
	const token = new vscode.CancellationTokenSource().token;
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		SessionManager._resetForTesting();
		TemplateMetadataStore._resetForTesting();
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		TemplateMetadataStore._resetForTesting();
		LinkManager._resetForTesting();
		SessionManager._resetForTesting();
	});

	test('returns immediately with no work when the document is not a linked template', async () => {
		const doc = await openDoc(`template('${LINKED_TEMPLATE_ID}')`);
		// Deliberately no LinkManager.addLink for this document's own uri.
		const result = provider.provideDefinition(doc, position, token);
		assert.strictEqual(result, undefined);
	});

	test('navigates straight to the local file when the referenced template is linked', async () => {
		const doc = await openDoc(`template('${LINKED_TEMPLATE_ID}')`);
		// The file under the cursor must itself be linked for the provider to do any work.
		LinkManager.addLink(templateLink(doc.uri, 'host-template', 'host-org', 'Host Org', 'Host Template'));
		const targetUri = vscode.Uri.file('/ws/other.j2');
		LinkManager.addLink(templateLink(targetUri, LINKED_TEMPLATE_ID, 'org-linked', 'Linked Org', 'Linked Template'));

		const result = provider.provideDefinition(doc, position, token);
		assert.ok(Array.isArray(result), 'expected a LocationLink array');
		const [locationLink] = result as vscode.LocationLink[];
		assert.strictEqual(locationLink.targetUri.toString(), targetUri.toString());
	});

	test('fetches, saves, and links a cached-but-unlinked template in the background, opening it', async () => {
		const cacheOrg = Fixtures.orgModel({ id: 'cache-org', name: 'Cache Org' });
		const doc = await openDoc(`template('${CACHED_TEMPLATE_ID}')`);
		// Link the editor's own file to a different template in the same org so the
		// org counts as "linked" and its templates load with priority (no deferred wait).
		LinkManager.addLink(templateLink(doc.uri, 'anchor-template', cacheOrg.id, cacheOrg.name, 'Anchor Template'));

		const { session, wrapper } = createMockSession({ profile: { org: cacheOrg, allManagedOrgs: [cacheOrg] } });
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery([
				Fixtures.template({ id: 'anchor-template', name: 'Anchor Template', orgId: cacheOrg.id }),
				Fixtures.template({ id: CACHED_TEMPLATE_ID, name: 'Cached Template', orgId: cacheOrg.id }),
			]),
		});

		SessionManager._setSessionsForTesting([session]);
		TemplateMetadataStore.init();
		await new Promise(resolve => setTimeout(resolve, 100));

		// Sanity check: the referenced template is cached but not itself linked.
		assert.strictEqual(LinkManager.getTemplateLinkFromId(CACHED_TEMPLATE_ID).length, 0);

		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: CACHED_TEMPLATE_ID,
				name: 'Cached Template',
				orgId: cacheOrg.id,
				organization: Fixtures.org({ id: cacheOrg.id, name: cacheOrg.name }),
			}),
		});

		// Stub the vscode primitives createAndLinkNewTemplate drives, so the
		// background flow runs without a real "Save As" dialog or network call.
		const newFileUri = vscode.Uri.file('/ws/new-cached-template.j2');
		const shownDocs: string[] = [];

		stub(
			vscode.workspace,
			'openTextDocument',
			(async (uri: vscode.Uri) =>
				({ uri }) as vscode.TextDocument) as unknown as typeof vscode.workspace.openTextDocument,
		);
		stub(vscode.window, 'showTextDocument', (async (untitledDoc: vscode.TextDocument) => {
			shownDocs.push(untitledDoc.uri.toString());
			return {
				document: untitledDoc,
				edit: async (callback: (editBuilder: vscode.TextEditorEdit) => void) => {
					callback({ insert: () => undefined } as unknown as vscode.TextEditorEdit);
					return true;
				},
			} as unknown as vscode.TextEditor;
		}) as unknown as typeof vscode.window.showTextDocument);
		stub(vscode.workspace, 'saveAs', (async () => newFileUri) as typeof vscode.workspace.saveAs);

		const result = provider.provideDefinition(doc, position, token);
		assert.strictEqual(result, undefined, 'the fetch-and-link happens in the background, not synchronously');

		await new Promise(resolve => setTimeout(resolve, 150));

		const getTemplateCalls = wrapper.getCallsFor('getTemplate');
		assert.strictEqual(getTemplateCalls.length, 1, 'the template was fetched');
		assert.strictEqual(getTemplateCalls[0].variables.id, CACHED_TEMPLATE_ID);

		const newLinks = LinkManager.getTemplateLinkFromId(CACHED_TEMPLATE_ID);
		assert.strictEqual(newLinks.length, 1, 'the fetched template gets linked to the newly saved file');
		assert.strictEqual(newLinks[0].uriString, newFileUri.toString());

		assert.ok(shownDocs.length > 0, 'the new file was opened in an editor');
	});
});
