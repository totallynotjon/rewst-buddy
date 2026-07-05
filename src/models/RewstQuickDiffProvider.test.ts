import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment, stub } from '@test';
import { REWST_REMOTE_SCHEME } from './RewstContentProvider';
import { RewstQuickDiffProvider } from './RewstQuickDiffProvider';

const { suite, test, setup, teardown } = Mocha;

function makeTemplateLink(uri: vscode.Uri, orgId: string, orgName: string, templateId: string): TemplateLink {
	return {
		uriString: uri.toString(),
		org: { id: orgId, name: orgName },
		type: 'Template',
		template: { id: templateId, name: 'Template 1', updatedAt: '' } as any,
		bodyHash: 'hash',
	};
}

suite('Unit: RewstQuickDiffProvider', () => {
	const uri = vscode.Uri.file('/test/linked.txt');

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		RewstQuickDiffProvider._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		RewstQuickDiffProvider._resetForTesting();
	});

	test('provideOriginalResource returns undefined for an unlinked uri', async () => {
		let calls = 0;
		const restore = stub(SessionManager, 'getSessionForOrg', (async (...args: unknown[]) => {
			calls++;
			throw new Error(`unexpected getSessionForOrg call: ${JSON.stringify(args)}`);
		}) as typeof SessionManager.getSessionForOrg);
		try {
			const result = await RewstQuickDiffProvider.provideOriginalResource(uri);
			assert.strictEqual(result, undefined);
			assert.strictEqual(calls, 0);
		} finally {
			restore();
		}
	});

	test('provideOriginalResource returns a rewst-remote uri for a linked uri, fetching once', async () => {
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', { data: Fixtures.getTemplateQuery({ id: 't1', body: '// remote body' }) });
		SessionManager._setSessionsForTesting([session]);
		LinkManager.addLink(makeTemplateLink(uri, org.id, org.name, 't1'));

		const result = await RewstQuickDiffProvider.provideOriginalResource(uri);
		assert.ok(result);
		assert.strictEqual(result!.scheme, REWST_REMOTE_SCHEME);
		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);
	});

	test('reuses the cached body within the TTL without refetching', async () => {
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', { data: Fixtures.getTemplateQuery({ id: 't1', body: '// remote body' }) });
		SessionManager._setSessionsForTesting([session]);
		LinkManager.addLink(makeTemplateLink(uri, org.id, org.name, 't1'));

		await RewstQuickDiffProvider.provideOriginalResource(uri);
		await RewstQuickDiffProvider.provideOriginalResource(uri);

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);
	});

	test('refetches after the TTL expires', async () => {
		RewstQuickDiffProvider._setTtlForTesting(1);
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', { data: Fixtures.getTemplateQuery({ id: 't1', body: '// remote body' }) });
		SessionManager._setSessionsForTesting([session]);
		LinkManager.addLink(makeTemplateLink(uri, org.id, org.name, 't1'));

		await RewstQuickDiffProvider.provideOriginalResource(uri);
		await new Promise(resolve => setTimeout(resolve, 20));
		await RewstQuickDiffProvider.provideOriginalResource(uri);

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 2);
	});

	test('falls back to the stale cached body when a refetch fails', async () => {
		RewstQuickDiffProvider._setTtlForTesting(0);
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		let calls = 0;
		wrapper.when('getTemplate', () => {
			calls++;
			if (calls === 1) return { data: Fixtures.getTemplateQuery({ id: 't1', body: '// first body' }) };
			return { error: Fixtures.networkError('engine unavailable') };
		});
		SessionManager._setSessionsForTesting([session]);
		LinkManager.addLink(makeTemplateLink(uri, org.id, org.name, 't1'));

		const first = await RewstQuickDiffProvider.provideOriginalResource(uri);
		assert.ok(first);

		const second = await RewstQuickDiffProvider.provideOriginalResource(uri);
		assert.ok(second, 'should fall back to the stale cache instead of returning undefined');
		assert.strictEqual(second!.scheme, REWST_REMOTE_SCHEME);
		assert.strictEqual(calls, 2, 'a refetch was attempted and failed');
	});

	test('dispose() clears the cache and disposes the SourceControl', async () => {
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', { data: Fixtures.getTemplateQuery({ id: 't1', body: '// remote body' }) });
		SessionManager._setSessionsForTesting([session]);
		LinkManager.addLink(makeTemplateLink(uri, org.id, org.name, 't1'));

		RewstQuickDiffProvider.init();
		await RewstQuickDiffProvider.provideOriginalResource(uri);
		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);

		RewstQuickDiffProvider.dispose();

		await RewstQuickDiffProvider.provideOriginalResource(uri);
		assert.strictEqual(
			wrapper.getCallsFor('getTemplate').length,
			2,
			'dispose must clear the cache, not just unregister',
		);
	});
});
