import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { PACK_INTEGRATION_CAPABILITIES } from './packIntegrationCapabilities';
const { suite, test, setup } = Mocha;

const { fakeCtx, cap } = createCapabilityTestHarness(PACK_INTEGRATION_CAPABILITIES);

suite('Unit: packIntegrationCapabilities', () => {
	setup(() => initTestEnvironment());

	// --- Zod parse tests ---
	test('missing packName throws with clear message', async () => {
		const { ctx } = fakeCtx({ data: {} });
		await assert.rejects(() => cap('buddy_get_pack_auth_status').run({ orgId: 'org-1' }, ctx), /packName/);
	});

	test('missing orgId throws before GraphQL for buddy_list_installed_packs', async () => {
		const { ctx } = fakeCtx({ data: {} });
		await assert.rejects(() => cap('buddy_list_installed_packs').run({}, ctx), /orgId/);
	});

	test('non-number limit for buddy_list_integrations falls back to default (no throw)', async () => {
		const { ctx } = fakeCtx({ data: { integrations: [] } });
		await assert.doesNotReject(() => cap('buddy_list_integrations').run({ orgId: 'org-1', limit: 'bad' }, ctx));
	});

	test('over-max limit is clamped to 200 for buddy_list_integrations', async () => {
		const { ctx, calls } = fakeCtx({ data: { integrations: [] } });
		await cap('buddy_list_integrations').run({ orgId: 'org-1', limit: 9999 }, ctx);
		assert.strictEqual(calls[0].variables!.limit, 200);
	});

	test('buddy_list_integrations derived schema has orgId required and args generated', () => {
		const schema = cap('buddy_list_integrations').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.strictEqual(cap('buddy_list_integrations').spec.args, JSON.stringify(schema));
	});

	test('buddy_get_pack_auth_status derived schema has orgId and packName required and args generated', () => {
		const schema = cap('buddy_get_pack_auth_status').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.ok(schema.required.includes('packName'));
		assert.strictEqual(cap('buddy_get_pack_auth_status').spec.args, JSON.stringify(schema));
	});

	test('buddy_list_installed_packs formats rows', async () => {
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
		const result = await cap('buddy_list_installed_packs').run({ orgId: 'org-1' }, ctx);
		assert.ok(typeof result === 'string' && result.includes('microsoft_graph'));
	});

	test('buddy_get_pack_auth_status returns configured when url is null', async () => {
		const { ctx } = fakeCtx({ data: { packAuthUrl: null } });
		const result = await cap('buddy_get_pack_auth_status').run(
			{ orgId: 'org-1', packName: 'microsoft_graph' },
			ctx,
		);
		assert.ok(typeof result === 'string' && result.includes('configured'));
	});

	test('buddy_get_pack_auth_status returns setup url when present', async () => {
		const { ctx } = fakeCtx({ data: { packAuthUrl: 'https://example.com/auth' } });
		const result = await cap('buddy_get_pack_auth_status').run(
			{ orgId: 'org-1', packName: 'microsoft_graph' },
			ctx,
		);
		assert.ok(typeof result === 'string' && result.includes('needs setup'));
	});

	test('buddy_list_pack_configs query has no limit arg', async () => {
		const { ctx, calls } = fakeCtx({ data: { packConfigs: [] } });
		await cap('buddy_list_pack_configs').run({ orgId: 'org-1' }, ctx);
		const capturedQuery = calls[0].query;
		assert.ok(capturedQuery.includes('packConfigs('));
		assert.ok(!capturedQuery.includes('limit'));
	});

	test('buddy_list_integrations formats rows', async () => {
		const { ctx } = fakeCtx({
			data: {
				integrations: [{ name: 'Slack', description: 'Slack integration', numInstalled: 5, isPublic: true }],
			},
		});
		const result = await cap('buddy_list_integrations').run({ orgId: 'org-1' }, ctx);
		assert.ok(typeof result === 'string' && !result.includes('integrations('));
		assert.ok(typeof result === 'string' && result.includes('Slack'));
	});
});
