import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import { _resetMcpMutationApproverForTesting, setMcpMutationApprover, type CapabilityContext } from '@capabilities';
import { LinkManager, type SyncDecision, type SyncDecisionContext, type TemplateLink } from '@models';
import { SessionManager, type FullTemplateFragment, type Session } from '@sessions';
import vscode from 'vscode';
import { _resetApprovedMutationScopes } from '../ui/chat/tools/graphqlTool';
import {
	defaultTemplateSyncDeps,
	matchLinkByPath,
	resolveLinkedUri,
	runSync,
	runSyncStatus,
	TEMPLATE_SYNC_CAPABILITIES,
	type TemplateSyncDeps,
	type TemplateSyncTarget,
} from './templateSyncCapabilities';

const { suite, test, setup, teardown } = Mocha;

interface TargetOpts {
	action: SyncDecision['action'];
	orgId?: string;
	/** Stale org stored on the link itself; defaults to the template's org. */
	linkOrgId?: string;
	remoteOrgId?: string;
	templateId?: string;
	templateName?: string;
	localBody?: string;
	remoteBody?: string;
	localUpdatedAt?: string;
	remoteUpdatedAt?: string;
	dirty?: boolean;
}

function makeTarget(opts: TargetOpts): TemplateSyncTarget {
	const orgId = opts.orgId ?? 'org-sandbox';
	const templateId = opts.templateId ?? 't1';
	const templateName = opts.templateName ?? 'Greeting';
	const link = {
		type: 'Template',
		uriString: 'file:///ws/greeting.j2',
		org: { id: opts.linkOrgId ?? orgId, name: 'Sandbox' },
		bodyHash: 'h',
		template: { id: templateId, name: templateName, updatedAt: opts.localUpdatedAt ?? '1', orgId },
	} as unknown as TemplateLink;
	const remoteTemplate = {
		id: templateId,
		name: templateName,
		body: opts.remoteBody ?? 'remote',
		updatedAt: opts.remoteUpdatedAt ?? '1',
		orgId: opts.remoteOrgId ?? orgId,
	} as unknown as FullTemplateFragment;
	const context: SyncDecisionContext = {
		link,
		session: {} as unknown as Session,
		remoteTemplate,
		localBody: opts.localBody ?? 'local',
		decision: opts.action === 'conflict' ? { action: 'conflict', changed: 'both' } : { action: opts.action },
	};
	const uri = { fsPath: '/ws/greeting.j2', toString: () => 'file:///ws/greeting.j2' } as unknown as vscode.Uri;
	return { uri, doc: {} as unknown as vscode.TextDocument, context, dirty: opts.dirty ?? false };
}

interface DepCalls {
	upload: number;
	download: number;
	refreshMetadata: number;
	saveIfDirty: number;
}

function makeDeps(target: TemplateSyncTarget | null, overrides: Partial<TemplateSyncDeps> = {}) {
	const calls: DepCalls = { upload: 0, download: 0, refreshMetadata: 0, saveIfDirty: 0 };
	const deps: TemplateSyncDeps = {
		prepare: async () => (target ? { kind: 'ready', target } : { kind: 'unlinked' }),
		isSyncOnSaveEnabled: () => true,
		saveIfDirty: async () => {
			calls.saveIfDirty++;
		},
		upload: async () => {
			calls.upload++;
			return { templateId: target?.context.link.template.id ?? 't1', name: 'Greeting', updatedAt: '2' };
		},
		download: async () => {
			calls.download++;
		},
		refreshMetadata: async () => {
			calls.refreshMetadata++;
		},
		...overrides,
	};
	return { deps, calls };
}

function makeCtx(orgId = 'org-sandbox'): CapabilityContext {
	const session = {
		profile: { org: { id: orgId, name: 'Sandbox' }, allManagedOrgs: [{ id: orgId, name: 'Sandbox' }] },
	} as unknown as Session;
	return { session, orgId, sessions: [session] };
}

function addTemplateLink(fsPath: string, orgId = 'org-1', templateId = 't1'): vscode.Uri {
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

suite('Unit: templateSyncCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		LinkManager._resetForTesting();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	suite('buddy_template_sync_status', () => {
		test('reports unlinked files without touching Rewst', async () => {
			const { deps } = makeDeps(null);
			const out = JSON.parse(await runSyncStatus({ uri: 'unknown.j2' }, makeCtx(), deps));
			assert.strictEqual(out.linked, false);
			assert.strictEqual(out.uri, 'unknown.j2');
		});

		test('maps update-metadata to in-sync with no recommended direction', async () => {
			const { deps } = makeDeps(makeTarget({ action: 'update-metadata', localBody: 'same', remoteBody: 'same' }));
			const out = JSON.parse(await runSyncStatus({ uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.linked, true);
			assert.strictEqual(out.status, 'in-sync');
			assert.strictEqual(out.recommendedDirection, 'none');
			assert.strictEqual(out.bodiesMatch, true);
			assert.strictEqual(out.orgId, 'org-sandbox');
			assert.strictEqual(out.templateId, 't1');
			assert.strictEqual(out.syncOnSave, true);
		});

		test('maps upload-local to local-ahead', async () => {
			const { deps } = makeDeps(makeTarget({ action: 'upload-local' }));
			const out = JSON.parse(await runSyncStatus({ uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'local-ahead');
			assert.strictEqual(out.recommendedDirection, 'upload');
		});

		test('maps download-remote to remote-only', async () => {
			const { deps } = makeDeps(makeTarget({ action: 'download-remote', localBody: '' }));
			const out = JSON.parse(await runSyncStatus({ uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'remote-only');
			assert.strictEqual(out.recommendedDirection, 'download');
			assert.strictEqual(out.localEmpty, true);
		});

		test('maps conflict and surfaces resolve as the recommended direction', async () => {
			const { deps } = makeDeps(makeTarget({ action: 'conflict' }));
			const out = JSON.parse(await runSyncStatus({ uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'conflict');
			assert.strictEqual(out.recommendedDirection, 'resolve');
		});

		test('rejects a missing uri', async () => {
			const { deps } = makeDeps(makeTarget({ action: 'update-metadata' }));
			await assert.rejects(() => runSyncStatus({}, makeCtx(), deps), /Missing required string argument "uri"/);
		});
	});

	suite('buddy_template_sync (auto direction)', () => {
		test('refreshes metadata when bodies already match, without uploading or prompting', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'update-metadata' }));
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			const out = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));

			assert.strictEqual(out.status, 'in-sync');
			assert.strictEqual(calls.refreshMetadata, 1);
			assert.strictEqual(calls.upload, 0);
			assert.strictEqual(approverCalled, false);
		});

		test('metadata-sync returns the refreshed remote template name, not the stale link name', async () => {
			const target = makeTarget({ action: 'update-metadata', templateName: 'Old Name' });
			target.context.remoteTemplate.name = 'New Remote Name';
			const { deps } = makeDeps(target);
			const out = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'in-sync');
			assert.strictEqual(out.name, 'New Remote Name');
		});

		test('downloads when the local file is empty, never prompting for approval', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'download-remote', localBody: '' }));
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});
			const out = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'downloaded');
			assert.strictEqual(calls.download, 1);
			assert.strictEqual(calls.upload, 0);
			assert.strictEqual(approverCalled, false);
		});

		test('uploads local-ahead changes after approval, saving first', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'upload-local', dirty: true }));
			let approverCalls = 0;
			setMcpMutationApprover(async () => {
				approverCalls++;
				return true;
			});

			const out = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));

			assert.strictEqual(out.status, 'uploaded');
			assert.strictEqual(approverCalls, 1);
			assert.strictEqual(calls.saveIfDirty, 1);
			assert.strictEqual(calls.upload, 1);
		});

		test('does not upload when approval is denied', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'upload-local' }));
			setMcpMutationApprover(async () => false);

			const out = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));

			assert.strictEqual(out.status, 'approval_required');
			assert.strictEqual(calls.upload, 0);
			assert.strictEqual(calls.saveIfDirty, 0);
		});

		test('reuses a prior approval and does not prompt twice for the same template', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'upload-local' }));
			let approverCalls = 0;
			setMcpMutationApprover(async () => {
				approverCalls++;
				return true;
			});

			const first = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));
			const second = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));

			assert.strictEqual(first.status, 'uploaded');
			assert.strictEqual(second.status, 'uploaded');
			assert.strictEqual(approverCalls, 1, 'the second upload reuses the first approval');
			assert.strictEqual(calls.upload, 2);
		});

		test('stops on a conflict and changes nothing', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'conflict' }));
			setMcpMutationApprover(async () => true);

			const out = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));

			assert.strictEqual(out.status, 'conflict');
			assert.strictEqual(calls.upload, 0);
			assert.strictEqual(calls.download, 0);
			assert.strictEqual(calls.refreshMetadata, 0);
		});
	});

	suite('buddy_template_sync (explicit direction)', () => {
		test('upload resolves a conflict by overwriting Rewst (with approval)', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'conflict' }));
			setMcpMutationApprover(async () => true);

			const out = JSON.parse(
				await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2', direction: 'upload' }, makeCtx(), deps),
			);

			assert.strictEqual(out.status, 'uploaded');
			assert.strictEqual(calls.upload, 1);
		});

		test('download resolves a conflict by overwriting the local file, no approval', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'conflict' }));
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			const out = JSON.parse(
				await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2', direction: 'download' }, makeCtx(), deps),
			);

			assert.strictEqual(out.status, 'downloaded');
			assert.strictEqual(calls.download, 1);
			assert.strictEqual(approverCalled, false);
		});

		test('an explicit upload still no-ops when bodies already match', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'update-metadata' }));
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			const out = JSON.parse(
				await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2', direction: 'upload' }, makeCtx(), deps),
			);

			assert.strictEqual(out.status, 'in-sync');
			assert.strictEqual(calls.refreshMetadata, 1);
			assert.strictEqual(calls.upload, 0);
			assert.strictEqual(approverCalled, false);
		});

		test('an explicit upload of an empty local file warns that it clears the remote', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'download-remote', localBody: '' }));
			let promptSummary = '';
			setMcpMutationApprover(async (_scope, summary) => {
				promptSummary = summary;
				return true;
			});

			const out = JSON.parse(
				await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2', direction: 'upload' }, makeCtx(), deps),
			);

			assert.strictEqual(out.status, 'uploaded');
			assert.match(promptSummary, /CLEARS the remote template body/);
			assert.match(out.message, /remote template body was cleared/);
			assert.strictEqual(calls.upload, 1);
		});

		test('rejects an invalid direction', async () => {
			const { deps } = makeDeps(makeTarget({ action: 'upload-local' }));
			await assert.rejects(
				() => runSync({ orgId: 'org-sandbox', uri: 'greeting.j2', direction: 'sideways' }, makeCtx(), deps),
				/"direction" must be one of/,
			);
		});
	});

	suite('buddy_template_sync (guards)', () => {
		test('reports not_linked when no template is linked', async () => {
			const { deps } = makeDeps(null);
			const out = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'x.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'not_linked');
		});

		test('refuses when the linked org differs from the requested org', async () => {
			const { deps, calls } = makeDeps(makeTarget({ action: 'upload-local', orgId: 'org-OTHER' }));
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps),
				/linked to org org-OTHER, not org-sandbox/,
			);
			assert.strictEqual(calls.upload, 0);
		});

		test('uploads when link.org is stale but the template org matches the requested org', async () => {
			// orgForTemplateLink must derive the real org from template.orgId; trusting
			// the stale link.org ('org-STALE') would wrongly reject this upload.
			const { deps, calls } = makeDeps(
				makeTarget({ action: 'upload-local', orgId: 'org-sandbox', linkOrgId: 'org-STALE' }),
			);
			setMcpMutationApprover(async () => true);
			const out = JSON.parse(await runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps));
			assert.strictEqual(out.status, 'uploaded');
			assert.strictEqual(calls.upload, 1);
		});

		test('refuses when link.org matches the request but the template org does not', async () => {
			// The guard must follow the template's org, not the stale link.org: here the
			// link claims the requested org yet the template belongs elsewhere.
			const { deps, calls } = makeDeps(
				makeTarget({ action: 'upload-local', orgId: 'org-OTHER', linkOrgId: 'org-sandbox' }),
			);
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps),
				/linked to org org-OTHER, not org-sandbox/,
			);
			assert.strictEqual(calls.upload, 0);
		});

		test('refuses when the remote template belongs to another org', async () => {
			const { deps, calls } = makeDeps(
				makeTarget({ action: 'upload-local', orgId: 'org-sandbox', remoteOrgId: 'org-OTHER' }),
			);
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps),
				/Template t1 is not in org org-sandbox/,
			);
			assert.strictEqual(calls.upload, 0);
		});

		test('fails closed when the remote template has no orgId', async () => {
			const target = makeTarget({ action: 'upload-local', orgId: 'org-sandbox' });
			delete (target.context.remoteTemplate as { orgId?: unknown }).orgId;
			const { deps, calls } = makeDeps(target);
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => runSync({ orgId: 'org-sandbox', uri: 'greeting.j2' }, makeCtx(), deps),
				/Template t1 is not in org org-sandbox/,
			);
			assert.strictEqual(calls.upload, 0);
		});

		test('rejects a missing orgId', async () => {
			const { deps } = makeDeps(makeTarget({ action: 'upload-local' }));
			await assert.rejects(
				() => runSync({ uri: 'greeting.j2' }, makeCtx(), deps),
				/Missing required string argument "orgId"/,
			);
		});
	});

	suite('matchLinkByPath', () => {
		const links = [
			{ uriString: 'file:///ws/templates/greeting.j2', fsPath: '/ws/templates/greeting.j2' },
			{ uriString: 'file:///ws/other.j2', fsPath: '/ws/other.j2' },
		];

		test('matches an exact link URI string', () => {
			assert.strictEqual(matchLinkByPath('file:///ws/other.j2', links), 'file:///ws/other.j2');
		});

		test('matches an exact filesystem path', () => {
			assert.strictEqual(matchLinkByPath('/ws/templates/greeting.j2', links), 'file:///ws/templates/greeting.j2');
		});

		test('matches a workspace-relative suffix', () => {
			assert.strictEqual(matchLinkByPath('templates/greeting.j2', links), 'file:///ws/templates/greeting.j2');
		});

		test('returns undefined when nothing matches', () => {
			assert.strictEqual(matchLinkByPath('nope.j2', links), undefined);
		});

		test('returns undefined for an empty request or empty link set', () => {
			assert.strictEqual(matchLinkByPath('', links), undefined);
			assert.strictEqual(matchLinkByPath('greeting.j2', []), undefined);
		});

		test('normalizes backslash separators before matching', () => {
			assert.strictEqual(matchLinkByPath('templates\\greeting.j2', links), 'file:///ws/templates/greeting.j2');
		});

		test('strips a leading ./ before matching', () => {
			assert.strictEqual(matchLinkByPath('./templates/greeting.j2', links), 'file:///ws/templates/greeting.j2');
		});

		test('matching is case-sensitive', () => {
			assert.strictEqual(matchLinkByPath('/WS/templates/greeting.j2', links), undefined);
		});

		test('refuses an ambiguous suffix that matches more than one link', () => {
			const dupLinks = [
				{ uriString: 'file:///ws/a/dup.j2', fsPath: '/ws/a/dup.j2' },
				{ uriString: 'file:///ws/b/dup.j2', fsPath: '/ws/b/dup.j2' },
			];
			assert.strictEqual(matchLinkByPath('dup.j2', dupLinks), undefined);
			// An unambiguous exact path still resolves.
			assert.strictEqual(matchLinkByPath('/ws/a/dup.j2', dupLinks), 'file:///ws/a/dup.j2');
		});
	});

	suite('resolveLinkedUri (against the live LinkManager)', () => {
		test('resolves an exact file URI to its template link', () => {
			const uri = addTemplateLink('/ws/templates/greeting.j2', 'org-1', 't1');
			const resolved = resolveLinkedUri(uri.toString());
			assert.ok(resolved);
			assert.strictEqual(resolved.link.template.id, 't1');
			assert.strictEqual(resolved.uri.toString(), uri.toString());
		});

		test('resolves an absolute filesystem path', () => {
			addTemplateLink('/ws/templates/greeting.j2', 'org-1', 't1');
			assert.strictEqual(resolveLinkedUri('/ws/templates/greeting.j2')?.link.template.id, 't1');
		});

		test('resolves a workspace-relative suffix', () => {
			addTemplateLink('/ws/templates/greeting.j2', 'org-1', 't1');
			assert.strictEqual(resolveLinkedUri('templates/greeting.j2')?.link.template.id, 't1');
		});

		test('returns undefined for an unlinked path', () => {
			addTemplateLink('/ws/templates/greeting.j2');
			assert.strictEqual(resolveLinkedUri('not/linked.j2'), undefined);
		});

		test('refuses an ambiguous bare filename matching two linked files', () => {
			addTemplateLink('/ws/a/dup.j2', 'org-1', 't-a');
			addTemplateLink('/ws/b/dup.j2', 'org-1', 't-b');
			assert.strictEqual(resolveLinkedUri('dup.j2'), undefined);
			assert.strictEqual(resolveLinkedUri('/ws/a/dup.j2')?.link.template.id, 't-a');
		});
	});

	suite('defaultTemplateSyncDeps.upload', () => {
		setup(() => {
			SessionManager._resetForTesting();
		});

		teardown(() => {
			SessionManager._resetForTesting();
		});

		test('resolves the session fresh at upload time instead of reusing target.context.session', async () => {
			const org = { id: 'org-upload-fresh', name: 'Upload Fresh' };
			const uri = addTemplateLink('/ws/upload-fresh.j2', org.id, 'tpl-upload-fresh');
			const link = LinkManager.getTemplateLink(uri);

			// The session captured in target.context (e.g. before an approval
			// prompt) must not be the one used at mutation time.
			const { session: staleSession, wrapper: staleWrapper } = createMockSession({
				profile: { org, allManagedOrgs: [org] },
			});
			const { session: freshSession, wrapper: freshWrapper } = createMockSession({
				profile: { org, allManagedOrgs: [org] },
			});
			freshWrapper.when('updateTemplateBody', {
				data: Fixtures.updateTemplateBodyMutation({
					id: 'tpl-upload-fresh',
					name: 'Greeting',
					updatedAt: 'ts-uploaded',
					orgId: org.id,
				}),
			});
			SessionManager._setSessionsForTesting([freshSession]);

			const doc = { uri, getText: () => 'local body' } as unknown as vscode.TextDocument;
			const target: TemplateSyncTarget = {
				uri,
				doc,
				dirty: false,
				context: {
					link,
					session: staleSession,
					remoteTemplate: {
						id: 'tpl-upload-fresh',
						name: 'Greeting',
						body: 'remote',
						updatedAt: '1',
						orgId: org.id,
					},
					localBody: 'local body',
					decision: { action: 'upload-local' },
				} as unknown as SyncDecisionContext,
			};

			await defaultTemplateSyncDeps.upload(target);

			assert.strictEqual(
				staleWrapper.getCallsFor('updateTemplateBody').length,
				0,
				'the session captured on target.context must not be used for the upload',
			);
			assert.strictEqual(
				freshWrapper.getCallsFor('updateTemplateBody').length,
				1,
				'the freshly-resolved session should receive the upload',
			);
		});

		test('propagates a clear error when no session remains for the org at upload time', async () => {
			const org = { id: 'org-upload-missing', name: 'Upload Missing' };
			const uri = addTemplateLink('/ws/upload-missing.j2', org.id, 'tpl-upload-missing');
			const link = LinkManager.getTemplateLink(uri);
			const { session: staleSession, wrapper: staleWrapper } = createMockSession({
				profile: { org, allManagedOrgs: [org] },
			});

			// No session registered for the org — simulates removal while the
			// approval prompt was pending.
			SessionManager._setSessionsForTesting([]);

			const doc = { uri, getText: () => 'local body' } as unknown as vscode.TextDocument;
			const target: TemplateSyncTarget = {
				uri,
				doc,
				dirty: false,
				context: {
					link,
					session: staleSession,
					remoteTemplate: {
						id: 'tpl-upload-missing',
						name: 'Greeting',
						body: 'remote',
						updatedAt: '1',
						orgId: org.id,
					},
					localBody: 'local body',
					decision: { action: 'upload-local' },
				} as unknown as SyncDecisionContext,
			};

			await assert.rejects(() => defaultTemplateSyncDeps.upload(target), /no session found/);
			assert.strictEqual(
				staleWrapper.getCallsFor('updateTemplateBody').length,
				0,
				'the stale session captured on target.context must not be used as a fallback',
			);
		});
	});

	suite('capability descriptors', () => {
		function cap(name: string) {
			const capability = TEMPLATE_SYNC_CAPABILITIES.find(candidate => candidate.spec.name === name);
			assert.ok(capability, `missing capability ${name}`);
			return capability;
		}

		test('buddy_template_sync_status is a read tool, mcp-only, no org required', () => {
			const c = cap('buddy_template_sync_status');
			assert.strictEqual(c.access, 'read');
			assert.strictEqual(c.requiresOrg, false);
		});

		test('buddy_template_sync is a write tool, mcp-only, and stays org-scoped', () => {
			const c = cap('buddy_template_sync');
			assert.strictEqual(c.access, 'write');
			assert.notStrictEqual(c.requiresOrg, false);
		});
	});
});
