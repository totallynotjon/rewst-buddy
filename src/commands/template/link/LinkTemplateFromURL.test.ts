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
import { LinkTemplateFromURL } from './LinkTemplateFromURL';

const { suite, test, setup, teardown } = Mocha;

/**
 * LinkTemplateFromURL drives the "Link a local file from URL" scenario of
 * the "Open or link a template from its Rewst URL" requirement: refuse if
 * already linked, parse the URL, resolve a session, fetch the template, link
 * the file, then sync. This test only exercises the primary-org-match path
 * of session resolution (see the template-management spec's
 * managed-sub-org implementation-status note); the mock session's default
 * region loginUrl is http://localhost:9999/login, so the URL below uses
 * that host.
 */
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const templateURL = `http://localhost:9999/organizations/${ORG_ID}/templates/${TEMPLATE_ID}`;

suite('Unit: LinkTemplateFromURL', () => {
	let tmpDir: string;
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
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-link-from-url-'));
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

	test('links the open file to the parsed template and syncs', async () => {
		const body = '// local body to link';
		const uri = writeFile('to-link.j2', body);

		const org = Fixtures.orgModel({ id: ORG_ID, name: 'Org One' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', () => ({
			data: Fixtures.getTemplateQuery({
				id: TEMPLATE_ID,
				orgId: ORG_ID,
				organization: Fixtures.org({ id: ORG_ID, name: 'Org One' }),
				body,
			}),
		}));
		SessionManager._setSessionsForTesting([session]);
		stubURLInput(templateURL);

		await new LinkTemplateFromURL().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), true);
		const link = LinkManager.getTemplateLink(uri);
		assert.strictEqual(link.template.id, TEMPLATE_ID);
		assert.strictEqual(link.org.id, ORG_ID);
		assert.strictEqual(link.bodyHash, getHash(body), 'bodyHash reflects the local file content at link time');

		assert.strictEqual(
			wrapper.getCallsFor('getTemplate').length,
			2,
			'one fetch while linking, one fetch from the follow-up sync',
		);
	});

	test('refuses before parsing the URL when the file is already linked', async () => {
		const uri = writeFile('already-linked.j2', 'body');
		const existingLink: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: 'org-existing', name: 'Existing Org' },
			template: { id: 'tpl-existing', name: 'Existing', updatedAt: '', orgId: 'org-existing' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(existingLink);

		stubURLInput(templateURL);

		await assert.rejects(() => new LinkTemplateFromURL().execute([uri]), /Already linked/);
	});

	test('rejects before linking when the URL prompt is cancelled', async () => {
		const uri = writeFile('cancelled.j2', 'body');
		stubURLInput(undefined);

		await assert.rejects(() => new LinkTemplateFromURL().execute([uri]), /not a string/);
		assert.strictEqual(LinkManager.isLinked(uri), false, 'no link is created when the URL is missing');
	});

	test('rejects before linking when the URL is malformed', async () => {
		const uri = writeFile('malformed.j2', 'body');
		stubURLInput('not-a-valid-template-url');

		await assert.rejects(() => new LinkTemplateFromURL().execute([uri]));
		assert.strictEqual(LinkManager.isLinked(uri), false, 'no link is created when the URL cannot be parsed');
	});
});
