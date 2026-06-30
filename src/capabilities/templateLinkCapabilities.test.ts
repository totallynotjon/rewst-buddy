import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { CapabilityContext } from '@capabilities';
import { LinkManager, SyncOnSaveManager, type TemplateLink } from '@models';
import type { FullTemplateFragment, Session } from '@sessions';
import { getHash } from '@utils';
import vscode from 'vscode';
import {
	resolvePathToUri,
	runLink,
	runLinkStatus,
	runSyncOnSave,
	runUnlink,
	TEMPLATE_LINK_CAPABILITIES,
	type TemplateLinkDeps,
} from './templateLinkCapabilities';

const { suite, test, setup, teardown } = Mocha;

const REF_UUID = '11111111-1111-1111-1111-111111111111';
const BODY_WITH_REF = `{{ template('${REF_UUID}') }}`;

function makeCtx(): CapabilityContext {
	const session = {} as unknown as Session;
	return { session, orgId: 'org-1', sessions: [session] };
}

function fakeTemplate(over: Partial<FullTemplateFragment> = {}): FullTemplateFragment {
	return {
		id: 't1',
		name: 'Greeting',
		body: 'remote body',
		updatedAt: '2024-05-05T00:00:00Z',
		orgId: 'org-1',
		organization: { id: 'org-1', name: 'Org One' },
		contentType: 'text',
		language: 'jinja',
		tags: [],
		...over,
	} as unknown as FullTemplateFragment;
}

interface LinkDepOpts {
	resolveUndefined?: boolean;
	exists?: boolean;
	body?: string;
	getTemplate?: () => Promise<FullTemplateFragment>;
}

function makeLinkDeps(opts: LinkDepOpts = {}) {
	const uri = vscode.Uri.file('/ws/greeting.j2');
	const resolved = opts.resolveUndefined ? undefined : uri;
	const calls = { getTemplate: 0, readBody: 0 };
	const deps: TemplateLinkDeps = {
		resolvePathToUri: () => resolved,
		fileExists: async () => opts.exists ?? true,
		readBody: async () => {
			calls.readBody++;
			return opts.body ?? BODY_WITH_REF;
		},
		getTemplate: async () => {
			calls.getTemplate++;
			return opts.getTemplate ? opts.getTemplate() : fakeTemplate();
		},
	};
	return { deps, calls, uri };
}

function addLink(fsPath: string, templateId = 't1', orgId = 'org-1'): vscode.Uri {
	const uri = vscode.Uri.file(fsPath);
	const link: TemplateLink = {
		uriString: uri.toString(),
		org: { id: orgId, name: 'Org' },
		type: 'Template',
		template: { id: templateId, name: 'Greeting', updatedAt: '1' } as unknown as TemplateLink['template'],
		bodyHash: 'h',
	};
	LinkManager.addLink(link);
	return uri;
}

/**
 * Adds a link whose stored org is the stale session/parent org while the template
 * fragment carries the real sub-org. orgForTemplateLink must prefer the template's
 * org, so the link/status/unlink surfaces should report 'org-real', not 'org-stale'.
 */
function addStaleOrgLink(fsPath: string): vscode.Uri {
	const uri = vscode.Uri.file(fsPath);
	const link: TemplateLink = {
		uriString: uri.toString(),
		org: { id: 'org-stale', name: 'Stale Parent' },
		type: 'Template',
		template: {
			id: 't1',
			name: 'Greeting',
			updatedAt: '1',
			orgId: 'org-real',
			organization: { id: 'org-real', name: 'Real Sub Org' },
		} as unknown as TemplateLink['template'],
		bodyHash: 'h',
	};
	LinkManager.addLink(link);
	return uri;
}

suite('Unit: templateLinkCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	suite('capability descriptors', () => {
		test('all three are read tools, mcp-only, org-agnostic', () => {
			for (const name of ['buddy_template_link', 'buddy_template_unlink', 'buddy_template_sync_on_save']) {
				const c = TEMPLATE_LINK_CAPABILITIES.find(candidate => candidate.spec.name === name);
				assert.ok(c, `missing ${name}`);
				assert.strictEqual(c.access, 'read', `${name} access`);
				assert.strictEqual(c.mcp, true, `${name} mcp`);
				assert.strictEqual(c.chat, false, `${name} chat`);
				assert.strictEqual(c.requiresOrg, false, `${name} requiresOrg`);
			}
		});
	});

	suite('buddy_template_link', () => {
		test('links an existing file, storing the sentinel updatedAt and local bodyHash', async () => {
			const { deps, uri } = makeLinkDeps({ body: BODY_WITH_REF });
			const out = JSON.parse(await runLink({ templateId: 't1', uri: 'greeting.j2' }, makeCtx(), deps));

			assert.strictEqual(out.status, 'linked');
			assert.strictEqual(out.templateId, 't1');
			assert.strictEqual(out.orgId, 'org-1');
			assert.deepStrictEqual(out.referencedTemplateIds, [REF_UUID]);
			assert.ok(LinkManager.isLinked(uri), 'link persisted');
			const link = LinkManager.getTemplateLink(uri);
			assert.strictEqual(link.template.updatedAt, '0', 'stores sentinel, not real remote updatedAt');
			assert.strictEqual((link.template as { body?: unknown }).body, '');
			assert.strictEqual(link.bodyHash, getHash(BODY_WITH_REF));
		});

		test('returns invalid_path when the path cannot be resolved', async () => {
			const { deps } = makeLinkDeps({ resolveUndefined: true });
			const out = JSON.parse(await runLink({ templateId: 't1', uri: '???' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'invalid_path');
		});

		test('returns file_not_found when the file does not exist', async () => {
			const { deps, uri } = makeLinkDeps({ exists: false });
			const out = JSON.parse(await runLink({ templateId: 't1', uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'file_not_found');
			assert.ok(!LinkManager.isLinked(uri));
		});

		test('refuses to relink an already-linked file unless overwrite is set', async () => {
			const uri = vscode.Uri.file('/ws/greeting.j2');
			addLink('/ws/greeting.j2', 'old-template');
			const { deps } = makeLinkDeps({});

			const blocked = JSON.parse(await runLink({ templateId: 't1', uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(blocked.status, 'already_linked');
			assert.strictEqual(LinkManager.getTemplateLink(uri).template.id, 'old-template', 'unchanged');

			const replaced = JSON.parse(
				await runLink({ templateId: 't1', uri: 'greeting.j2', overwrite: true }, makeCtx(), deps),
			);
			assert.strictEqual(replaced.status, 'linked');
			assert.strictEqual(LinkManager.getTemplateLink(uri).template.id, 't1', 'replaced');
		});

		test('overwriting a link clears the old template-id reverse lookup (#90 — no stale results)', async () => {
			// The "tool returns stale results" symptom at the capability boundary:
			// re-linking via overwrite used to leave the OLD template id pointing at
			// the file, so getTemplateLinkFromId (hover, ctrl-click, open-by-id)
			// resolved to it. Assert the reverse lookup moves with the link.
			const uri = vscode.Uri.file('/ws/greeting.j2');
			addLink('/ws/greeting.j2', 'old-template');
			const { deps } = makeLinkDeps({});

			const replaced = JSON.parse(
				await runLink({ templateId: 't1', uri: 'greeting.j2', overwrite: true }, makeCtx(), deps),
			);
			assert.strictEqual(replaced.status, 'linked');
			assert.deepStrictEqual(LinkManager.getTemplateLinkFromId('old-template'), [], 'old reverse lookup cleared');
			const current = LinkManager.getTemplateLinkFromId('t1');
			assert.strictEqual(current.length, 1, 'new reverse lookup populated');
			assert.strictEqual(current[0].uriString, uri.toString());
		});

		test('returns template_not_found when no session resolves the template', async () => {
			const { deps, uri } = makeLinkDeps({
				getTemplate: async () => {
					throw new Error('not found');
				},
			});
			const out = JSON.parse(await runLink({ templateId: 'missing', uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'template_not_found');
			assert.ok(!LinkManager.isLinked(uri));
		});

		test('returns org_mismatch when the template is in a different org than requested', async () => {
			const { deps, uri } = makeLinkDeps({ getTemplate: async () => fakeTemplate({ orgId: 'org-2' }) });
			const out = JSON.parse(
				await runLink({ templateId: 't1', uri: 'greeting.j2', orgId: 'org-1' }, makeCtx(), deps),
			);
			assert.strictEqual(out.status, 'org_mismatch');
			assert.ok(!LinkManager.isLinked(uri));
		});

		test('rejects a missing templateId', async () => {
			const { deps } = makeLinkDeps({});
			await assert.rejects(
				() => runLink({ uri: 'greeting.j2' }, makeCtx(), deps),
				/Missing required string argument "templateId"/,
			);
		});

		test('finds the template via a later session when the first cannot', async () => {
			const uri = vscode.Uri.file('/ws/greeting.j2');
			const s1 = {} as unknown as Session;
			const s2 = {} as unknown as Session;
			const deps: TemplateLinkDeps = {
				resolvePathToUri: () => uri,
				fileExists: async () => true,
				readBody: async () => BODY_WITH_REF,
				getTemplate: async session => {
					if (session === s1) throw new Error('first session cannot read it');
					return fakeTemplate();
				},
			};
			const ctx: CapabilityContext = { session: s1, orgId: 'org-1', sessions: [s1, s2] };
			const out = JSON.parse(await runLink({ templateId: 't1', uri: 'greeting.j2' }, ctx, deps));
			assert.strictEqual(out.status, 'linked');
			assert.ok(LinkManager.isLinked(uri));
		});

		test('propagates an operational fetch error instead of reporting template_not_found', async () => {
			const { deps, uri } = makeLinkDeps({
				getTemplate: async () => {
					throw new Error('Network error: ECONNRESET');
				},
			});
			await assert.rejects(
				() => runLink({ templateId: 't1', uri: 'greeting.j2' }, makeCtx(), deps),
				/Network error/,
			);
			assert.ok(!LinkManager.isLinked(uri), 'no link created on an operational failure');
		});
	});

	suite('resolvePathToUri', () => {
		test('returns undefined for empty or whitespace input', () => {
			assert.strictEqual(resolvePathToUri(''), undefined);
			assert.strictEqual(resolvePathToUri('   '), undefined);
		});

		test('parses a file:// URI', () => {
			const u = resolvePathToUri('file:///ws/x.j2');
			assert.ok(u);
			assert.strictEqual(u.fsPath, '/ws/x.j2');
		});

		test('treats an absolute path as a file URI', () => {
			const u = resolvePathToUri('/ws/x.j2');
			assert.ok(u);
			assert.strictEqual(u.scheme, 'file');
			assert.strictEqual(u.fsPath, '/ws/x.j2');
		});

		test('resolves a relative path against a workspace folder, or undefined without one', () => {
			const folders = vscode.workspace.workspaceFolders;
			const u = resolvePathToUri('sub/x.j2');
			if (!folders || folders.length === 0) {
				assert.strictEqual(u, undefined);
			} else {
				assert.ok(u);
				assert.ok(u.fsPath.endsWith('/sub/x.j2'));
			}
		});
	});

	suite('buddy_template_unlink', () => {
		test('removes the link for a linked file', async () => {
			const uri = addLink('/ws/greeting.j2', 't1');
			const out = JSON.parse(await runUnlink({ uri: 'greeting.j2' }, makeCtx()));
			assert.strictEqual(out.status, 'unlinked');
			assert.strictEqual(out.templateId, 't1');
			assert.ok(!LinkManager.isLinked(uri), 'link removed');
		});

		test('reports the template-derived org id, not the stale link.org', async () => {
			addStaleOrgLink('/ws/greeting.j2');
			const out = JSON.parse(await runUnlink({ uri: 'greeting.j2' }, makeCtx()));
			assert.strictEqual(out.status, 'unlinked');
			assert.strictEqual(out.orgId, 'org-real');
		});

		test('returns not_linked when the file is not linked', async () => {
			const out = JSON.parse(await runUnlink({ uri: 'nope.j2' }, makeCtx()));
			assert.strictEqual(out.status, 'not_linked');
		});

		test('rejects a missing uri', async () => {
			await assert.rejects(() => runUnlink({}, makeCtx()), /Missing required string argument "uri"/);
		});
	});

	suite('buddy_template_sync_on_save', () => {
		test('enables sync-on-save for a linked file', async () => {
			const uri = addLink('/ws/greeting.j2', 't1');
			const out = JSON.parse(await runSyncOnSave({ uri: 'greeting.j2', enabled: true }, makeCtx()));
			assert.strictEqual(out.status, 'updated');
			assert.strictEqual(out.syncOnSave, true);
			assert.ok(SyncOnSaveManager.isUriSynced(uri));
		});

		test('disables sync-on-save for a linked file', async () => {
			const uri = addLink('/ws/greeting.j2', 't1');
			SyncOnSaveManager.enableSync(uri);
			const out = JSON.parse(await runSyncOnSave({ uri: 'greeting.j2', enabled: false }, makeCtx()));
			assert.strictEqual(out.syncOnSave, false);
			assert.ok(!SyncOnSaveManager.isUriSynced(uri));
		});

		test('returns not_linked when the file is not linked', async () => {
			const out = JSON.parse(await runSyncOnSave({ uri: 'nope.j2', enabled: true }, makeCtx()));
			assert.strictEqual(out.status, 'not_linked');
		});

		test('rejects a non-boolean enabled', async () => {
			addLink('/ws/greeting.j2', 't1');
			await assert.rejects(
				() => runSyncOnSave({ uri: 'greeting.j2', enabled: 'yes' }, makeCtx()),
				/"enabled" must be a boolean/,
			);
		});
	});

	suite('buddy_template_link_status', () => {
		test('is a read tool, mcp-only, org-agnostic', () => {
			const c = TEMPLATE_LINK_CAPABILITIES.find(x => x.spec.name === 'buddy_template_link_status');
			assert.ok(c, 'capability registered');
			assert.strictEqual(c.access, 'read');
			assert.strictEqual(c.mcp, true);
			assert.strictEqual(c.chat, false);
			assert.strictEqual(c.requiresOrg, false);
		});

		test('reports linked:true with template, org, and sync-on-save state', () => {
			const uri = addLink('/ws/greeting.j2', 't1');
			SyncOnSaveManager.enableSync(uri);

			const out = JSON.parse(runLinkStatus({ uri: 'greeting.j2' }));

			assert.strictEqual(out.linked, true);
			assert.strictEqual(out.templateId, 't1');
			assert.strictEqual(out.orgId, 'org-1');
			assert.strictEqual(out.syncOnSave, true);
			assert.strictEqual(out.path, uri.fsPath);
		});

		test('reports the template-derived org id and name, not the stale link.org', () => {
			addStaleOrgLink('/ws/greeting.j2');
			const out = JSON.parse(runLinkStatus({ uri: 'greeting.j2' }));
			assert.strictEqual(out.linked, true);
			assert.strictEqual(out.orgId, 'org-real');
			assert.strictEqual(out.orgName, 'Real Sub Org');
		});

		test('reports linked:false when no template is linked', () => {
			const out = JSON.parse(runLinkStatus({ uri: 'nope.j2' }));
			assert.strictEqual(out.linked, false);
		});

		test('rejects a missing uri', () => {
			assert.throws(() => runLinkStatus({}), /Missing required string argument "uri"/);
		});
	});
});
