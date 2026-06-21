import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import { ORG_USER_CAPABILITIES } from './orgUserCapabilities';
const { suite, test, setup } = Mocha;
const { fakeCtx, cap } = createCapabilityTestHarness(ORG_USER_CAPABILITIES);
suite('Unit: orgUserCapabilities', () => {
	setup(() => initTestEnvironment());

	test('search_organizations forwards name search and formats organizations', async () => {
		const { ctx, calls } = fakeCtx({
			data: { searchManagedOrgs: [{ id: 'o1', name: 'Acme', isEnabled: true }] },
		});

		const output = await cap('search_organizations').run({ orgId: 'org-1', search: 'acme' }, ctx);

		assert.strictEqual(calls[0].variables!.search, 'acme');
		assert.ok(output.includes('Acme'));
	});

	test('list_users uses users query, maps username search, and formats users', async () => {
		const { ctx, calls } = fakeCtx({
			data: { users: [{ id: 'u1', username: 'foo.user', isApiUser: false, roleIds: ['role-1'] }] },
		});

		const output = await cap('list_users').run({ orgId: 'org-1', search: 'foo' }, ctx);

		assert.ok(calls[0].query.includes('users('));
		assert.deepStrictEqual(calls[0].variables!.search, { username: { _ilike: '%foo%' } });
		assert.ok(output.includes('foo.user'));
		assert.ok(output.includes('roles: role-1'));
	});

	test('list_roles uses roles query and formats role rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: { roles: [{ id: 'r1', name: 'Admin', description: 'Full access' }] },
		});

		const output = await cap('list_roles').run({ orgId: 'org-1' }, ctx);

		assert.ok(calls[0].query.includes('roles('));
		assert.ok(output.includes('Admin (r1)'));
	});
});
