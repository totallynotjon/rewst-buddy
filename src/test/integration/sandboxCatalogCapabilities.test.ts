import { getCapability, type Capability, type CapabilityContext } from '@capabilities';
import type { Session } from '@sessions';
import { clearCachedSession, getTestOrgId, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { rawGraphqlOrThrow } from '../../capabilities/inputHelpers';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

function cap(name: string): Capability {
	const capability = getCapability(name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

function lineCount(output: string): number {
	return output.split('\n').filter(line => line.trim().length > 0).length;
}

const SANDBOX_CATALOG_ANCHORS = `query RbItestSandboxCatalogAnchors($orgId: ID!) {
  triggers(where: { orgId: $orgId }, limit: 3, order: [["name", "ASC"]]) { id name orgId }
  packsAndBundlesByInstalledState(orgId: $orgId) {
    installedPacksAndBundles { id name ref }
  }
  packConfigs(where: { orgId: $orgId }) { id name packId orgId }
}`;

suite('Integration: sandbox catalog capability tree', function () {
	this.timeout(120_000);

	let session: Session;
	let ctx: CapabilityContext;
	let orgId: string;
	let triggers: { id: string; name?: string; orgId?: string }[] = [];
	let installedPacks: { id?: string; name?: string; ref?: string }[] = [];
	let packConfigs: { id?: string; name?: string; packId?: string; orgId?: string }[] = [];

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		orgId = getTestOrgId();
		session = await getTestSession();
		if (session.profile.org.id !== orgId) {
			throw new Error(`Safety invariant failed: test session is not bound to sandbox ${orgId}.`);
		}
		ctx = { session, orgId, sessions: [session] };
		const data = (await rawGraphqlOrThrow(session, SANDBOX_CATALOG_ANCHORS, { orgId })) as {
			triggers?: typeof triggers;
			packsAndBundlesByInstalledState?: { installedPacksAndBundles?: typeof installedPacks };
			packConfigs?: typeof packConfigs;
		};
		triggers = data.triggers ?? [];
		installedPacks = data.packsAndBundlesByInstalledState?.installedPacksAndBundles ?? [];
		packConfigs = data.packConfigs ?? [];
		assert.ok(triggers.every(trigger => trigger.orgId === orgId));
		assert.ok(packConfigs.every(config => config.orgId === orgId));
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	test('buddy_list_org_variables returns masked sandbox configuration rows or a clean empty state', async () => {
		const output = await cap('buddy_list_org_variables').run({ orgId, limit: 5 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(lineCount(output) <= 5, output);
		assert.doesNotMatch(output, /password\s*=\s*(?!\*|\[masked\]|$)\S+/i);
	});

	test('buddy_list_users is bounded to direct users in the sandbox org', async () => {
		const output = await cap('buddy_list_users').run({ orgId, limit: 5 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(lineCount(output) <= 5, output);
		assert.ok(output.includes('No users found') || /\([^)]+\)/.test(output), output);
	});

	test('buddy_list_users applies a sandbox-local username filter', async function () {
		const all = await cap('buddy_list_users').run({ orgId, limit: 1 }, ctx);
		if (all.startsWith('No users found')) {
			this.skip();
			return;
		}
		const username = all.split(' (')[0];
		const filtered = await cap('buddy_list_users').run({ orgId, search: username, limit: 10 }, ctx);
		assert.ok(filtered.toLowerCase().includes(username.toLowerCase()), filtered);
	});

	test('buddy_list_roles returns sandbox role ids or its documented empty state', async () => {
		const output = await cap('buddy_list_roles').run({ orgId }, ctx);
		assert.ok(output.length > 0);
		assert.ok(output.includes('No roles found') || /\([^)]+\)/.test(output), output);
	});

	test('buddy_list_triggers is limited and contains only sandbox-discovered trigger ids', async () => {
		const output = await cap('buddy_list_triggers').run({ orgId, limit: 3 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(lineCount(output) <= 3, output);
		for (const trigger of triggers) assert.ok(output.includes(trigger.id), output);
	});

	test('buddy_get_trigger_error_status batch-checks sandbox trigger ids', async function () {
		if (triggers.length === 0) {
			this.skip();
			return;
		}
		const ids = triggers.slice(0, 3).map(trigger => trigger.id);
		const output = await cap('buddy_get_trigger_error_status').run({ orgId, triggerIds: ids }, ctx);
		assert.strictEqual(lineCount(output), ids.length, output);
		for (const id of ids) assert.match(output, new RegExp(`^${id}: (ERROR|ok|unknown)$`, 'm'));
	});

	test('buddy_list_forms returns bounded sandbox forms or a clean empty state', async () => {
		const output = await cap('buddy_list_forms').run({ orgId, limit: 4 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(lineCount(output) <= 4, output);
		assert.ok(output.includes('No forms found') || /\([^)]+\)/.test(output), output);
	});

	test('buddy_list_tags returns bounded sandbox tags or a clean empty state', async () => {
		const output = await cap('buddy_list_tags').run({ orgId, limit: 4 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(lineCount(output) <= 4, output);
		assert.ok(output.includes('No tags found') || /\([^)]+\)/.test(output), output);
	});

	test('buddy_list_org_trigger_instances returns bounded sandbox activations or a clean empty state', async () => {
		const output = await cap('buddy_list_org_trigger_instances').run({ orgId, limit: 4 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(lineCount(output) <= 4, output);
		assert.ok(output.includes('No trigger activation instances') || /trigger .* → instance/.test(output), output);
	});

	test('buddy_list_installed_packs agrees with sandbox-scoped catalog discovery', async () => {
		const output = await cap('buddy_list_installed_packs').run({ orgId }, ctx);
		if (installedPacks.length === 0) {
			assert.strictEqual(output, '');
			return;
		}
		for (const pack of installedPacks.slice(0, 5)) {
			const identity = pack.ref || pack.id;
			if (identity) assert.ok(output.includes(identity), `${identity}\n${output}`);
		}
	});

	test('buddy_list_pack_configs agrees with sandbox-scoped config discovery', async () => {
		const output = await cap('buddy_list_pack_configs').run({ orgId }, ctx);
		if (packConfigs.length === 0) {
			assert.strictEqual(output, '');
			return;
		}
		for (const config of packConfigs.slice(0, 5)) {
			if (config.id) assert.ok(output.includes(config.id), `${config.id}\n${output}`);
		}
	});

	test('buddy_get_pack_auth_status resolves a pack installed in the sandbox', async function () {
		const pack = installedPacks.find(candidate => candidate.ref);
		if (!pack?.ref) {
			this.skip();
			return;
		}
		const output = await cap('buddy_get_pack_auth_status').run({ orgId, packName: pack.ref }, ctx);
		assert.ok(output === 'configured (no auth URL needed)' || output.startsWith('needs setup: http'), output);
	});

	test('buddy_list_pages returns only bounded App Platform rows for the sandbox', async () => {
		const output = await cap('buddy_list_pages').run({ orgId, limit: 4 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(lineCount(output) <= 4, output);
		assert.ok(output.includes('No pages found') || /\([^)]+\)/.test(output), output);
	});

	test('buddy_list_sites returns sandbox sites or its documented empty state', async () => {
		const output = await cap('buddy_list_sites').run({ orgId }, ctx);
		assert.ok(output.length > 0);
		assert.ok(output.includes('No sites found') || /\[(live|not live)\]/.test(output), output);
	});

	test('buddy_search_crates uses the sandbox as selectedOrgId for catalog state', async () => {
		const output = await cap('buddy_search_crates').run({ orgId, limit: 5 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(lineCount(output) <= 7, output);
	});
});
