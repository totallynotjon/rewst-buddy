import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';
import { LinkManager, TemplateLink, TemplateMetadataStore } from '@models';
import { SessionManager } from '@sessions';
import { TemplateHoverProvider } from './TemplateHoverProvider';

const { suite, test, setup, teardown } = Mocha;

/**
 * Covers the hover side of the language-navigation spec: link-then-cache-then-
 * unknown precedence, and the fast "not a linked file" bail-out. TemplateHoverProvider
 * had zero coverage before this file.
 */
const LINKED_TEMPLATE_ID = '11111111-1111-1111-1111-111111111111';
const CACHED_TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';
const UNKNOWN_TEMPLATE_ID = '33333333-3333-3333-3333-333333333333';

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

function markdownText(hover: vscode.Hover): string {
	return hover.contents.map(c => (typeof c === 'string' ? c : (c as vscode.MarkdownString).value)).join('\n');
}

suite('Unit: TemplateHoverProvider', () => {
	const provider = new TemplateHoverProvider();
	const position = new vscode.Position(0, 5); // inside "template(" on a single-reference line
	const token = new vscode.CancellationTokenSource().token;

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		SessionManager._resetForTesting();
		TemplateMetadataStore._resetForTesting();
	});

	teardown(() => {
		TemplateMetadataStore._resetForTesting();
		LinkManager._resetForTesting();
		SessionManager._resetForTesting();
	});

	test('returns immediately with no work when the document is not a linked template', async () => {
		const doc = await openDoc(`template('${LINKED_TEMPLATE_ID}')`);
		// Deliberately no LinkManager.addLink for this document's own uri.
		const result = provider.provideHover(doc, position, token);
		assert.strictEqual(result, undefined);
	});

	test('shows the name and org from the link when the referenced template is linked locally', async () => {
		const doc = await openDoc(`template('${LINKED_TEMPLATE_ID}')`);
		// The file under the cursor must itself be linked for the provider to do any work.
		LinkManager.addLink(templateLink(doc.uri, 'host-template', 'host-org', 'Host Org', 'Host Template'));
		// The referenced template is linked to a different local file.
		LinkManager.addLink(
			templateLink(
				vscode.Uri.file('/ws/other.j2'),
				LINKED_TEMPLATE_ID,
				'org-linked',
				'Linked Org',
				'Linked Template',
			),
		);

		const result = provider.provideHover(doc, position, token);
		assert.ok(result instanceof vscode.Hover, 'expected a Hover result');
		const text = markdownText(result as vscode.Hover);
		assert.ok(text.includes('Linked Template'), 'shows the linked template name');
		assert.ok(text.includes('Linked Org'), 'shows the linked template org');
	});

	test('shows the name and org from cached metadata when the referenced template is only cached', async () => {
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

		const result = provider.provideHover(doc, position, token);
		assert.ok(result instanceof vscode.Hover, 'expected a Hover result');
		const text = markdownText(result as vscode.Hover);
		assert.ok(text.includes('Cached Template'), 'shows the cached template name');
		assert.ok(text.includes('Cache Org'), 'shows the cached template org');
	});

	test('shows the id and marks the template unknown when neither linked nor cached', async () => {
		const doc = await openDoc(`template('${UNKNOWN_TEMPLATE_ID}')`);
		LinkManager.addLink(templateLink(doc.uri, 'host-template', 'host-org', 'Host Org', 'Host Template'));

		const result = provider.provideHover(doc, position, token);
		assert.ok(result instanceof vscode.Hover, 'expected a Hover result');
		const text = markdownText(result as vscode.Hover);
		assert.ok(text.includes(UNKNOWN_TEMPLATE_ID), 'shows the raw template id');
		assert.ok(/unknown/i.test(text), 'marks the template as unknown');
	});
});
