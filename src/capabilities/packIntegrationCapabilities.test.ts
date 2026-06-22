import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import { PACK_INTEGRATION_CAPABILITIES } from './packIntegrationCapabilities';
const { suite, test, setup } = Mocha;

const { fakeCtx, cap } = createCapabilityTestHarness(PACK_INTEGRATION_CAPABILITIES);

suite('Unit: packIntegrationCapabilities', () => {
	setup(() => initTestEnvironment());

	test('list_installed_packs formats rows', async () => {
		const { ctx } = fakeCtx({
			data: {
				packsAndBundlesByInstalledState: {
					installedPacksAndBundles: [
						{
							id: 'p1',
							name: 'Microsoft Graph',
							ref: 'microsoft_graph',
							status: 'installed',
							isBundle: false,
							packType: 'integration',
						},
					],
				},
			},
		});
		const result = await cap('list_installed_packs').run({ orgId: 'org-1' }, ctx);
		assert.ok(typeof result === 'string' && result.includes('microsoft_graph'));
	});

	test('get_pack_auth_status returns configured when url is null', async () => {
		const { ctx } = fakeCtx({ data: { packAuthUrl: null } });
		const result = await cap('get_pack_auth_status').run({ orgId: 'org-1', packName: 'microsoft_graph' }, ctx);
		assert.ok(typeof result === 'string' && result.includes('configured'));
	});

	test('get_pack_auth_status returns setup url when present', async () => {
		const { ctx } = fakeCtx({ data: { packAuthUrl: 'https://example.com/auth' } });
		const result = await cap('get_pack_auth_status').run({ orgId: 'org-1', packName: 'microsoft_graph' }, ctx);
		assert.ok(typeof result === 'string' && result.includes('needs setup'));
	});

	test('list_pack_configs query has no limit arg', async () => {
		const { ctx, calls } = fakeCtx({ data: { packConfigs: [] } });
		await cap('list_pack_configs').run({ orgId: 'org-1' }, ctx);
		const capturedQuery = calls[0].query;
		assert.ok(capturedQuery.includes('packConfigs('));
		assert.ok(!capturedQuery.includes('limit'));
	});

	test('list_integrations formats rows', async () => {
		const { ctx } = fakeCtx({
			data: {
				integrations: [{ name: 'Slack', description: 'Slack integration', numInstalled: 5, isPublic: true }],
			},
		});
		const result = await cap('list_integrations').run({ orgId: 'org-1' }, ctx);
		assert.ok(typeof result === 'string' && !result.includes('integrations('));
		assert.ok(typeof result === 'string' && result.includes('Slack'));
	});
});
