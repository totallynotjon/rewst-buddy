import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { LinkManager, TemplateLink, TemplateMetadataStore } from '@models';
import { SessionManager } from '@sessions';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';

const { suite, test, setup, teardown } = Mocha;

function makeTemplateLink(orgId: string, orgName: string, templateId: string): TemplateLink {
	return {
		uriString: vscode.Uri.file(`/test/${templateId}.txt`).toString(),
		org: { id: orgId, name: orgName },
		type: 'Template',
		template: { id: templateId, name: `Template ${templateId}`, updatedAt: '' } as any,
		bodyHash: 'hash',
	};
}

suite('Unit: TemplateMetadataStore', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		TemplateMetadataStore._resetForTesting();
	});

	teardown(() => {
		TemplateMetadataStore._resetForTesting();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
	});

	suite('basic loading', () => {
		test('should load templates from a single session with linked org', async () => {
			const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Test Org 1' });
			const templates = [
				Fixtures.template({ id: 'template-1', name: 'Template 1', orgId: org1.id }),
				Fixtures.template({ id: 'template-2', name: 'Template 2', orgId: org1.id }),
				Fixtures.template({ id: 'template-3', name: 'Template 3', orgId: org1.id }),
			];

			const { session, wrapper } = createMockSession({
				profile: { org: org1, allManagedOrgs: [org1] },
			});

			wrapper.when('listTemplates', { data: Fixtures.listTemplatesQuery(templates) });
			LinkManager.addLink(makeTemplateLink(org1.id, org1.name, 'existing-link'));
			SessionManager._setSessionsForTesting([session]);

			TemplateMetadataStore.init();
			await new Promise(resolve => setTimeout(resolve, 100));

			assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 1);

			const meta1 = TemplateMetadataStore.getTemplateMetadata('template-1');
			assert.ok(meta1, 'Template 1 metadata should exist');
			assert.strictEqual(meta1?.template.name, 'Template 1');
			assert.strictEqual(meta1?.org.id, org1.id);

			const meta2 = TemplateMetadataStore.getTemplateMetadata('template-2');
			assert.ok(meta2, 'Template 2 metadata should exist');
			assert.strictEqual(meta2?.template.name, 'Template 2');
		});

		test('should load templates from multiple sessions with linked orgs', async () => {
			const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			const org2 = Fixtures.orgModel({ id: 'org-2', name: 'Org 2' });

			const org1Templates = [
				Fixtures.template({ id: 'template-1-1', name: 'Org 1 Template 1', orgId: org1.id }),
				Fixtures.template({ id: 'template-1-2', name: 'Org 1 Template 2', orgId: org1.id }),
			];

			const org2Templates = [Fixtures.template({ id: 'template-2-1', name: 'Org 2 Template 1', orgId: org2.id })];

			const { session: session1, wrapper: wrapper1 } = createMockSession({
				profile: { org: org1, allManagedOrgs: [org1] },
			});
			wrapper1.when('listTemplates', { data: Fixtures.listTemplatesQuery(org1Templates) });

			const { session: session2, wrapper: wrapper2 } = createMockSession({
				profile: { org: org2, allManagedOrgs: [org2] },
			});
			wrapper2.when('listTemplates', { data: Fixtures.listTemplatesQuery(org2Templates) });

			LinkManager.addLink(makeTemplateLink(org1.id, org1.name, 'link-org1'));
			LinkManager.addLink(makeTemplateLink(org2.id, org2.name, 'link-org2'));
			SessionManager._setSessionsForTesting([session1, session2]);

			TemplateMetadataStore.init();
			await new Promise(resolve => setTimeout(resolve, 100));

			assert.strictEqual(wrapper1.getCallsFor('listTemplates').length, 1);
			assert.strictEqual(wrapper2.getCallsFor('listTemplates').length, 1);

			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('template-1-1')?.template.name,
				'Org 1 Template 1',
			);
			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('template-1-2')?.template.name,
				'Org 1 Template 2',
			);
			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('template-2-1')?.template.name,
				'Org 2 Template 1',
			);
		});

		test('should return undefined for unknown template ID', () => {
			const result = TemplateMetadataStore.getTemplateMetadata('nonexistent');
			assert.strictEqual(result, undefined);
		});

		test('should handle SDK errors gracefully', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

			const { session, wrapper } = createMockSession({
				profile: { org, allManagedOrgs: [org] },
			});

			wrapper.when('listTemplates', {
				error: Fixtures.networkError('Failed to load templates'),
			});

			LinkManager.addLink(makeTemplateLink(org.id, org.name, 'link-1'));
			SessionManager._setSessionsForTesting([session]);
			TemplateMetadataStore.init();

			await new Promise(resolve => setTimeout(resolve, 100));

			assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 1);
			assert.strictEqual(TemplateMetadataStore.getTemplateMetadata('any-id'), undefined);
		});
	});

	suite('priority loading', () => {
		test('should load linked orgs immediately and defer non-linked orgs', async () => {
			const linkedOrg = Fixtures.orgModel({ id: 'linked-org', name: 'Linked Org' });
			const unlinkedOrg = Fixtures.orgModel({ id: 'unlinked-org', name: 'Unlinked Org' });

			const linkedTemplate = Fixtures.template({ id: 'linked-t1', name: 'Linked Template', orgId: linkedOrg.id });
			const unlinkedTemplate = Fixtures.template({
				id: 'unlinked-t1',
				name: 'Unlinked Template',
				orgId: unlinkedOrg.id,
			});

			const { session, wrapper } = createMockSession({
				profile: {
					org: linkedOrg,
					allManagedOrgs: [linkedOrg, unlinkedOrg],
				},
			});

			wrapper.when('listTemplates', (vars: any) => {
				if (vars.orgId === linkedOrg.id) {
					return { data: Fixtures.listTemplatesQuery([linkedTemplate]) };
				}
				return { data: Fixtures.listTemplatesQuery([unlinkedTemplate]) };
			});

			LinkManager.addLink(makeTemplateLink(linkedOrg.id, linkedOrg.name, 'existing-link'));
			SessionManager._setSessionsForTesting([session]);

			TemplateMetadataStore.init();
			await new Promise(resolve => setTimeout(resolve, 100));

			const linkedMeta = TemplateMetadataStore.getTemplateMetadata('linked-t1');
			assert.ok(linkedMeta, 'Linked org template should be loaded immediately');
			assert.strictEqual(linkedMeta!.template.name, 'Linked Template');

			const unlinkedMeta = TemplateMetadataStore.getTemplateMetadata('unlinked-t1');
			assert.strictEqual(unlinkedMeta, undefined, 'Unlinked org template should not be loaded yet');

			const calls = wrapper.getCallsFor('listTemplates');
			assert.strictEqual(calls.length, 1, 'Only linked org should have been called so far');
			assert.strictEqual(calls[0].variables.orgId, linkedOrg.id);
		});

		test('should defer all orgs when none have links', async () => {
			const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			const org2 = Fixtures.orgModel({ id: 'org-2', name: 'Org 2' });

			const { session, wrapper } = createMockSession({
				profile: {
					org: org1,
					allManagedOrgs: [org1, org2],
				},
			});

			wrapper.when('listTemplates', (vars: any) => {
				return { data: Fixtures.listTemplatesQuery([Fixtures.template({ orgId: vars.orgId })]) };
			});

			SessionManager._setSessionsForTesting([session]);
			TemplateMetadataStore.init();
			await new Promise(resolve => setTimeout(resolve, 100));

			const calls = wrapper.getCallsFor('listTemplates');
			assert.strictEqual(calls.length, 0, 'No orgs should load immediately when none have links');
		});

		test('should handle session with multiple managed orgs (only linked ones load first)', async () => {
			const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Primary Org' });
			const org2 = Fixtures.orgModel({ id: 'org-2', name: 'Managed Org 1' });
			const org3 = Fixtures.orgModel({ id: 'org-3', name: 'Managed Org 2' });

			const { session, wrapper } = createMockSession({
				profile: {
					org: org1,
					allManagedOrgs: [org1, org2, org3],
				},
			});

			wrapper.when('listTemplates', (vars: any) => {
				const templates = [
					Fixtures.template({ id: `t-${vars.orgId}`, name: `T ${vars.orgId}`, orgId: vars.orgId }),
				];
				return { data: Fixtures.listTemplatesQuery(templates) };
			});

			LinkManager.addLink(makeTemplateLink(org1.id, org1.name, 'link-org1'));
			LinkManager.addLink(makeTemplateLink(org3.id, org3.name, 'link-org3'));
			SessionManager._setSessionsForTesting([session]);
			TemplateMetadataStore.init();

			await new Promise(resolve => setTimeout(resolve, 100));

			// Only linked orgs (org1, org3) should have loaded immediately
			const calls = wrapper.getCallsFor('listTemplates');
			assert.strictEqual(calls.length, 2, 'Only 2 linked orgs should load immediately');
			const calledOrgIds = calls.map((c: any) => c.variables.orgId).sort();
			assert.deepStrictEqual(calledOrgIds, [org1.id, org3.id].sort());

			assert.ok(TemplateMetadataStore.getTemplateMetadata(`t-${org1.id}`));
			assert.ok(TemplateMetadataStore.getTemplateMetadata(`t-${org3.id}`));
			assert.strictEqual(TemplateMetadataStore.getTemplateMetadata(`t-${org2.id}`), undefined);
		});
	});

	suite('generation counter (stale write protection)', () => {
		test('should discard results from stale loads after reset', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });
			const template = Fixtures.template({ id: 't1', name: 'Template 1', orgId: org.id });

			const { session, wrapper } = createMockSession({
				profile: { org, allManagedOrgs: [org] },
			});

			LinkManager.addLink(makeTemplateLink(org.id, org.name, 'link-1'));
			wrapper.when('listTemplates', {
				data: Fixtures.listTemplatesQuery([template]),
				delay: 200,
			});

			SessionManager._setSessionsForTesting([session]);
			TemplateMetadataStore.init();

			// Reset while load is in flight
			await new Promise(resolve => setTimeout(resolve, 50));
			TemplateMetadataStore._resetForTesting();

			// Wait for the delayed response to arrive
			await new Promise(resolve => setTimeout(resolve, 300));

			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('t1'),
				undefined,
				'Stale load results should be discarded after reset',
			);
		});
	});

	suite('pendingReload', () => {
		test('should reload after current load finishes when triggered during loading', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

			const { session, wrapper } = createMockSession({
				profile: { org, allManagedOrgs: [org] },
			});

			LinkManager.addLink(makeTemplateLink(org.id, org.name, 'link-1'));

			let callCount = 0;
			wrapper.when('listTemplates', () => {
				callCount++;
				return {
					data: Fixtures.listTemplatesQuery([
						Fixtures.template({ id: `t-${callCount}`, name: `Template ${callCount}`, orgId: org.id }),
					]),
					delay: callCount === 1 ? 100 : 0,
				};
			});

			SessionManager._setSessionsForTesting([session]);
			TemplateMetadataStore.init();

			// Fire a session saved event while first load is in progress
			await new Promise(resolve => setTimeout(resolve, 20));
			SessionManager._setSessionsForTesting([session]);

			// Wait for both loads to complete
			await new Promise(resolve => setTimeout(resolve, 300));

			const calls = wrapper.getCallsFor('listTemplates');
			assert.ok(calls.length >= 2, `Expected at least 2 listTemplates calls, got ${calls.length}`);
		});
	});

	suite('deferred timer', () => {
		test('should load deferred orgs after timer fires', async () => {
			const linkedOrg = Fixtures.orgModel({ id: 'linked-org', name: 'Linked Org' });
			const deferredOrg = Fixtures.orgModel({ id: 'deferred-org', name: 'Deferred Org' });

			const linkedTemplate = Fixtures.template({ id: 'linked-t1', name: 'Linked Template', orgId: linkedOrg.id });
			const deferredTemplate = Fixtures.template({
				id: 'deferred-t1',
				name: 'Deferred Template',
				orgId: deferredOrg.id,
			});

			const { session, wrapper } = createMockSession({
				profile: { org: linkedOrg, allManagedOrgs: [linkedOrg, deferredOrg] },
			});

			wrapper.when('listTemplates', (vars: any) => {
				if (vars.orgId === linkedOrg.id) {
					return { data: Fixtures.listTemplatesQuery([linkedTemplate]) };
				}
				return { data: Fixtures.listTemplatesQuery([deferredTemplate]) };
			});

			LinkManager.addLink(makeTemplateLink(linkedOrg.id, linkedOrg.name, 'link-1'));
			TemplateMetadataStore._setDeferredDelayForTesting(200);
			SessionManager._setSessionsForTesting([session]);

			TemplateMetadataStore.init();

			// Wait for priority load only
			await new Promise(resolve => setTimeout(resolve, 50));
			assert.ok(
				TemplateMetadataStore.getTemplateMetadata('linked-t1'),
				'Linked template should load immediately',
			);
			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('deferred-t1'),
				undefined,
				'Deferred template should not be loaded yet',
			);

			// Wait for deferred timer (200ms) to fire and complete
			await new Promise(resolve => setTimeout(resolve, 300));
			assert.ok(
				TemplateMetadataStore.getTemplateMetadata('deferred-t1'),
				'Deferred template should load after timer fires',
			);
			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('deferred-t1')!.template.name,
				'Deferred Template',
			);
		});

		test('should discard stale deferred load when generation changes before timer fires', async () => {
			const linkedOrg = Fixtures.orgModel({ id: 'linked-org', name: 'Linked Org' });
			const deferredOrg = Fixtures.orgModel({ id: 'deferred-org', name: 'Deferred Org' });

			const { session, wrapper } = createMockSession({
				profile: { org: linkedOrg, allManagedOrgs: [linkedOrg, deferredOrg] },
			});

			wrapper.when('listTemplates', (vars: any) => {
				return {
					data: Fixtures.listTemplatesQuery([
						Fixtures.template({ id: `t-${vars.orgId}`, name: `T ${vars.orgId}`, orgId: vars.orgId }),
					]),
				};
			});

			LinkManager.addLink(makeTemplateLink(linkedOrg.id, linkedOrg.name, 'link-1'));
			TemplateMetadataStore._setDeferredDelayForTesting(100);
			SessionManager._setSessionsForTesting([session]);

			TemplateMetadataStore.init();
			await new Promise(resolve => setTimeout(resolve, 50));

			// Clear sessions before deferred timer fires — increments generation
			await SessionManager.clearProfiles();

			// Wait for deferred timer to fire
			await new Promise(resolve => setTimeout(resolve, 200));

			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata(`t-${deferredOrg.id}`),
				undefined,
				'Deferred load should be discarded after generation change',
			);
		});

		test('should not leak data when dispose is called with pending deferred timer', async () => {
			const linkedOrg = Fixtures.orgModel({ id: 'linked-org', name: 'Linked Org' });
			const deferredOrg = Fixtures.orgModel({ id: 'deferred-org', name: 'Deferred Org' });

			const { session, wrapper } = createMockSession({
				profile: { org: linkedOrg, allManagedOrgs: [linkedOrg, deferredOrg] },
			});

			wrapper.when('listTemplates', (vars: any) => {
				return {
					data: Fixtures.listTemplatesQuery([
						Fixtures.template({ id: `t-${vars.orgId}`, name: `T ${vars.orgId}`, orgId: vars.orgId }),
					]),
				};
			});

			LinkManager.addLink(makeTemplateLink(linkedOrg.id, linkedOrg.name, 'link-1'));
			TemplateMetadataStore._setDeferredDelayForTesting(100);
			SessionManager._setSessionsForTesting([session]);

			TemplateMetadataStore.init();
			await new Promise(resolve => setTimeout(resolve, 50));

			// Dispose before deferred timer fires
			TemplateMetadataStore.dispose();

			// Wait past when the deferred timer would have fired
			await new Promise(resolve => setTimeout(resolve, 200));

			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata(`t-${linkedOrg.id}`),
				undefined,
				'Linked org data should be cleared after dispose',
			);
			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata(`t-${deferredOrg.id}`),
				undefined,
				'Deferred org should not leak data after dispose',
			);
		});
	});

	suite('session change handling', () => {
		test('should clear metadata when sessions are cleared', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });
			const templates = [Fixtures.template({ id: 'template-1', name: 'Template 1', orgId: org.id })];

			const { session, wrapper } = createMockSession({
				profile: { org, allManagedOrgs: [org] },
			});
			wrapper.when('listTemplates', { data: Fixtures.listTemplatesQuery(templates) });

			LinkManager.addLink(makeTemplateLink(org.id, org.name, 'link-1'));
			SessionManager._setSessionsForTesting([session]);
			TemplateMetadataStore.init();

			await new Promise(resolve => setTimeout(resolve, 100));
			assert.ok(TemplateMetadataStore.getTemplateMetadata('template-1'), 'Template should be loaded');

			await SessionManager.clearProfiles();

			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('template-1'),
				undefined,
				'Template should be cleared after sessions cleared',
			);
		});

		test('should drop metadata for orgs no remaining session manages when one session is removed', async () => {
			const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			const org2 = Fixtures.orgModel({ id: 'org-2', name: 'Org 2' });

			const { session: session1, wrapper: wrapper1 } = createMockSession({
				profile: { user: Fixtures.userFragment({ id: 'user-1' }), org: org1, allManagedOrgs: [org1] },
			});
			wrapper1.when('listTemplates', {
				data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't-org1', name: 'T1', orgId: org1.id })]),
			});
			const { session: session2, wrapper: wrapper2 } = createMockSession({
				profile: { user: Fixtures.userFragment({ id: 'user-2' }), org: org2, allManagedOrgs: [org2] },
			});
			wrapper2.when('listTemplates', {
				data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't-org2', name: 'T2', orgId: org2.id })]),
			});

			LinkManager.addLink(makeTemplateLink(org1.id, org1.name, 'link-org1'));
			LinkManager.addLink(makeTemplateLink(org2.id, org2.name, 'link-org2'));
			SessionManager._setSessionsForTesting([session1, session2]);

			TemplateMetadataStore.init();
			await new Promise(resolve => setTimeout(resolve, 100));
			assert.ok(TemplateMetadataStore.getTemplateMetadata('t-org1'), 'org 1 metadata loaded');
			assert.ok(TemplateMetadataStore.getTemplateMetadata('t-org2'), 'org 2 metadata loaded');

			await SessionManager.removeSession('user-1');
			await new Promise(resolve => setTimeout(resolve, 100));

			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('t-org1'),
				undefined,
				"the removed session's org metadata must be dropped so hovers cannot offer dead sessions",
			);
			assert.ok(
				TemplateMetadataStore.getTemplateMetadata('t-org2'),
				"the surviving session's org metadata stays available",
			);
		});

		test('should not let an in-flight load re-insert metadata for a session removed mid-load', async () => {
			const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			const org2 = Fixtures.orgModel({ id: 'org-2', name: 'Org 2' });

			const { session: session1, wrapper: wrapper1 } = createMockSession({
				profile: { user: Fixtures.userFragment({ id: 'user-1' }), org: org1, allManagedOrgs: [org1] },
			});
			// Slow response: still in flight when the session is removed below.
			wrapper1.when('listTemplates', {
				data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't-org1', name: 'T1', orgId: org1.id })]),
				delay: 150,
			});
			const { session: session2, wrapper: wrapper2 } = createMockSession({
				profile: { user: Fixtures.userFragment({ id: 'user-2' }), org: org2, allManagedOrgs: [org2] },
			});
			wrapper2.when('listTemplates', {
				data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't-org2', name: 'T2', orgId: org2.id })]),
			});

			LinkManager.addLink(makeTemplateLink(org1.id, org1.name, 'link-org1'));
			LinkManager.addLink(makeTemplateLink(org2.id, org2.name, 'link-org2'));
			SessionManager._setSessionsForTesting([session1, session2]);

			TemplateMetadataStore.init();
			// Remove while org 1's listTemplates response is still pending.
			await new Promise(resolve => setTimeout(resolve, 50));
			await SessionManager.removeSession('user-1');

			// Let the delayed response land and any pending reload settle.
			await new Promise(resolve => setTimeout(resolve, 300));

			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('t-org1'),
				undefined,
				'a load already in flight when the session was removed must not re-insert its metadata',
			);
			assert.ok(
				TemplateMetadataStore.getTemplateMetadata('t-org2'),
				"the surviving session's org metadata stays available",
			);
		});
	});

	suite('dispose()', () => {
		test('should clear indexes on dispose', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });
			const template = Fixtures.template({ id: 't1', name: 'Template 1', orgId: org.id });

			const { session, wrapper } = createMockSession({
				profile: { org, allManagedOrgs: [org] },
			});

			wrapper.when('listTemplates', { data: Fixtures.listTemplatesQuery([template]) });
			LinkManager.addLink(makeTemplateLink(org.id, org.name, 'link-1'));
			SessionManager._setSessionsForTesting([session]);

			TemplateMetadataStore.init();
			await new Promise(resolve => setTimeout(resolve, 100));

			assert.ok(TemplateMetadataStore.getTemplateMetadata('t1'), 'Template should be loaded before dispose');

			TemplateMetadataStore.dispose();

			assert.strictEqual(
				TemplateMetadataStore.getTemplateMetadata('t1'),
				undefined,
				'Template should be cleared after dispose',
			);
		});
	});
});
