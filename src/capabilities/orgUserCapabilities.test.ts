import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { Session } from '@sessions';
import type { CapabilityContext } from './Capability';
import { ORG_USER_CAPABILITIES } from './orgUserCapabilities';
const { suite, test, setup } = Mocha;
function fakeCtx(response: unknown) {
	const calls: { query: string; variables: Record<string, unknown> }[] = [];
	const session = {
		rawGraphql: async (query: string, variables: Record<string, unknown>) => {
			calls.push({ query, variables });
			return response as { data?: unknown; errors?: unknown };
		},
	} as unknown as Session;
	const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
	return { ctx, calls };
}
function cap(name: string) {
	const c = ORG_USER_CAPABILITIES.find(x => x.spec.name === name);
	if (!c) throw new Error('missing ' + name);
	return c;
}
suite('Unit: orgUserCapabilities', () => {
	setup(() => initTestEnvironment());

	test('search_organizations forwards name search and formats organizations', async () => {
		const { ctx, calls } = fakeCtx({
			data: { searchManagedOrgs: [{ id: 'o1', name: 'Acme', isEnabled: true }] },
		});

		const output = await cap('search_organizations').run({ orgId: 'org-1', search: 'acme' }, ctx);

		assert.strictEqual(calls[0].variables.search, 'acme');
		assert.ok(output.includes('Acme'));
	});

	test('list_users uses users query, maps username search, and formats users', async () => {
		const { ctx, calls } = fakeCtx({
			data: { users: [{ id: 'u1', username: 'foo.user', isApiUser: false, roleIds: ['r1'] }] },
		});

		const output = await cap('list_users').run({ orgId: 'org-1', search: 'foo' }, ctx);

		assert.ok(calls[0].query.includes('users('));
		assert.deepStrictEqual(calls[0].variables.search, { username: { _ilike: '%foo%' } });
		assert.ok(output.includes('foo.user'));
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
