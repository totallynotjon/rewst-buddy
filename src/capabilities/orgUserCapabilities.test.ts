import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import { ORG_USER_CAPABILITIES } from './orgUserCapabilities';
const { suite, test, setup } = Mocha;
const { fakeCtx, cap } = createCapabilityTestHarness(ORG_USER_CAPABILITIES);
suite('Unit: orgUserCapabilities', () => {
	setup(() => initTestEnvironment());

	// --- Zod parse tests ---
	test('missing orgId throws before GraphQL for buddy_list_users', async () => {
		const { ctx } = fakeCtx({ data: {} });
		await assert.rejects(() => cap('buddy_list_users').run({}, ctx), /orgId/);
	});

	test('missing orgId throws before GraphQL for buddy_search_organizations', async () => {
		const { ctx } = fakeCtx({ data: {} });
		await assert.rejects(() => cap('buddy_search_organizations').run({}, ctx), /orgId/);
	});

	test('non-number limit falls back to default for buddy_list_users (no throw)', async () => {
		const { ctx } = fakeCtx({ data: { users: [] } });
		await assert.doesNotReject(() => cap('buddy_list_users').run({ orgId: 'org-1', limit: 'bad' }, ctx));
	});

	test('over-max limit is clamped to 200 for buddy_list_users', async () => {
		const { ctx, calls } = fakeCtx({ data: { users: [] } });
		await cap('buddy_list_users').run({ orgId: 'org-1', limit: 9999 }, ctx);
		assert.strictEqual(calls[0].variables!.limit, 200);
	});

	test('over-max limit is clamped to 100 for buddy_search_organizations', async () => {
		const { ctx, calls } = fakeCtx({ data: { searchManagedOrgs: [] } });
		await cap('buddy_search_organizations').run({ orgId: 'org-1', limit: 9999 }, ctx);
		assert.strictEqual(calls[0].variables!.limit, 100);
	});

	test('buddy_search_organizations derived schema has orgId required and args generated', () => {
		const schema = cap('buddy_search_organizations').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.strictEqual(cap('buddy_search_organizations').spec.args, JSON.stringify(schema));
	});

	test('buddy_list_users derived schema has orgId required and args generated', () => {
		const schema = cap('buddy_list_users').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.strictEqual(cap('buddy_list_users').spec.args, JSON.stringify(schema));
	});

	test('buddy_list_roles derived schema has orgId required and args generated', () => {
		const schema = cap('buddy_list_roles').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.strictEqual(cap('buddy_list_roles').spec.args, JSON.stringify(schema));
	});

	test('buddy_search_organizations forwards name search and formats organizations', async () => {
		const { ctx, calls } = fakeCtx({
			data: { searchManagedOrgs: [{ id: 'o1', name: 'Acme', isEnabled: true }] },
		});

		const output = await cap('buddy_search_organizations').run({ orgId: 'org-1', search: 'acme' }, ctx);

		assert.strictEqual(calls[0].variables!.search, 'acme');
		assert.ok(output.includes('Acme'));
	});

	test('buddy_list_users uses users query, maps username search, and formats users', async () => {
		const { ctx, calls } = fakeCtx({
			data: { users: [{ id: 'u1', username: 'foo.user', isApiUser: false, roleIds: ['role-1'] }] },
		});

		const output = await cap('buddy_list_users').run({ orgId: 'org-1', search: 'foo' }, ctx);

		assert.ok(calls[0].query.includes('users('));
		assert.deepStrictEqual(calls[0].variables!.search, { username: { _ilike: '%foo%' } });
		assert.ok(output.includes('foo.user'));
		assert.ok(output.includes('roles: role-1'));
	});

	test('buddy_list_roles uses roles query and formats role rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: { roles: [{ id: 'r1', name: 'Admin', description: 'Full access' }] },
		});

		const output = await cap('buddy_list_roles').run({ orgId: 'org-1' }, ctx);

		assert.ok(calls[0].query.includes('roles('));
		assert.ok(output.includes('Admin (r1)'));
	});
});
