import type { Session } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { CapabilityContext } from './Capability';
import { getCapability } from './registry';

const { suite, test, setup } = Mocha;

function useRawGraphqlWrapper(session: Session, wrapper: ReturnType<typeof createMockSession>['wrapper']): void {
	const wrap = wrapper.getWrapper();
	(session as { rawGraphql: Session['rawGraphql'] }).rawGraphql = async (query, variables) => {
		return wrap(async () => ({ data: undefined, errors: undefined }), 'rawGraphql', 'query RewstBuddyMcpCrates', {
			query,
			variables,
		});
	};
}

suite('Unit: crateCapabilities', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('registered read capability, derived schema', () => {
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap, 'buddy_search_crates is registered');
		assert.strictEqual(cap.access, 'read');
		const schema = cap.spec.inputSchema as {
			required: string[];
			properties: Record<string, unknown>;
		};
		assert.deepStrictEqual(schema.required, ['orgId'], 'only orgId is required');
		assert.ok('search' in schema.properties, 'search property exists');
		assert.ok('source' in schema.properties, 'source property exists');
		assert.ok('limit' in schema.properties, 'limit property exists');
		assert.strictEqual(cap.spec.args, JSON.stringify(cap.spec.inputSchema), 'args are generated from inputSchema');
	});

	test('catalog search forwards selectedOrgId + name _ilike, flags installs', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					crates: [
						{
							id: 'c-1',
							name: 'User Onboarding',
							category: 'Identity',
							description: 'Full onboarding',
							isUnpackedForSelectedOrg: true,
						},
						{
							id: 'c-2',
							name: 'User Offboarding',
							category: null,
							description: null,
							isUnpackedForSelectedOrg: false,
						},
					],
				},
			},
		});
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1', search: 'user', limit: 10 }, ctx);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		const vars = (calls[0].variables as { variables: Record<string, unknown> }).variables;
		assert.strictEqual(vars.selectedOrgId, 'org-1', 'selectedOrgId passed');
		assert.deepStrictEqual(vars.search, { name: { _ilike: '%user%' } }, 'search variable set correctly');
		assert.strictEqual(vars.limit, 10, 'limit passed');

		assert.ok(output.includes('User Onboarding (c-1)'), 'c-1 listed');
		assert.ok(output.includes('[installed in this org]'), 'installed marker present for c-1');
		assert.ok(output.includes('User Offboarding (c-2)'), 'c-2 listed');
		// c-2 should NOT have the installed marker
		const c2LineMatch = output.match(/User Offboarding \(c-2\)[^\n]*/)?.[0] ?? '';
		assert.ok(!c2LineMatch.includes('[installed in this org]'), 'c-2 does not carry installed marker');
		// null category renders as uncategorized
		assert.ok(output.includes('uncategorized'), 'null category renders as uncategorized');
	});

	test('omitted search sends no search variable', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					crates: [
						{
							id: 'c-1',
							name: 'User Onboarding',
							category: 'Identity',
							description: 'Full onboarding',
							isUnpackedForSelectedOrg: false,
						},
					],
				},
			},
		});
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await cap.run({ orgId: 'org-1' }, ctx);

		const calls = wrapper.getCallsFor('rawGraphql');
		const vars = (calls[0].variables as { variables: Record<string, unknown> }).variables;
		assert.strictEqual(vars.search, undefined, 'search variable is undefined when not provided');
		assert.strictEqual(vars.limit, 25, 'default limit is 25');
	});

	test('empty result → plain message', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					crates: [],
				},
			},
		});
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1', search: 'zzz' }, ctx);
		assert.ok(output.includes('No crates found'), 'output includes no-crates message');
		assert.ok(output.includes('"zzz"'), 'output includes the search term');
		assert.ok(output.length > 0, 'output is non-empty');
	});

	test('limit clamps and coerces', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', { data: { data: { crates: [] } } });
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };

		// Over-limit clamps to MAX (100)
		await cap.run({ orgId: 'org-1', limit: 5000 }, ctx);
		const calls1 = wrapper.getCallsFor('rawGraphql');
		const vars1 = (calls1[0].variables as { variables: Record<string, unknown> }).variables;
		assert.strictEqual(vars1.limit, 100, 'limit clamped to MAX 100');

		// Negative/invalid → default (25)
		await cap.run({ orgId: 'org-1', limit: -3 }, ctx);
		const calls2 = wrapper.getCallsFor('rawGraphql');
		const vars2 = (calls2[1].variables as { variables: Record<string, unknown> }).variables;
		assert.strictEqual(vars2.limit, 25, 'invalid limit falls back to default 25');
	});

	test('long descriptions truncated', async () => {
		const longDesc = 'x'.repeat(500);
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					crates: [
						{
							id: 'c-long',
							name: 'Long Desc Crate',
							category: 'Ops',
							description: longDesc,
							isUnpackedForSelectedOrg: false,
						},
					],
				},
			},
		});
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1' }, ctx);
		// The full 500-char string must not appear
		assert.ok(!output.includes(longDesc), 'full 500-char description not in output');
		// The truncated description ends with ellipsis
		assert.ok(output.includes('…'), 'truncated description ends with ellipsis');
		// The description portion in the output is ≤ 200 chars + '…'
		const descMatch = output.match(/: (x+…)/);
		assert.ok(descMatch, 'description found in output');
		assert.ok(descMatch![1].length <= 201, 'truncated description ≤ 200 chars + ellipsis');
	});

	test('public source pages publicCrates and filters client-side', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					publicCrates: [
						{ id: 'p-1', name: 'Alpha Sync', category: 'Ops', description: 'd' },
						{ id: 'p-2', name: 'Beta Notify', category: null, description: null },
					],
				},
			},
		});
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1', source: 'public', search: 'alpha' }, ctx);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		const query = (calls[0].variables as { query: string }).query;
		assert.ok(query.includes('publicCrates'), 'query uses publicCrates');
		assert.ok(!query.includes('selectedOrgId'), 'query does not use selectedOrgId');
		const vars = (calls[0].variables as { variables: Record<string, unknown> }).variables;
		assert.strictEqual(vars.limit, 200, 'fixed server page of 200 sent');

		// Client-side filter: only Alpha Sync matches 'alpha'
		assert.ok(output.includes('Alpha Sync (p-1)'), 'Alpha Sync listed');
		assert.ok(!output.includes('Beta Notify'), 'Beta Notify filtered out client-side');
		// No installed markers for public source
		assert.ok(!output.includes('[installed in this org]'), 'no installed markers for public source');
	});

	test('public source keeps paging until a search match is found after the first page', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const firstPage = Array.from({ length: 200 }, (_, i) => ({
			id: `p-${i}`,
			name: `Notify ${i}`,
			category: 'Ops',
			description: null,
		}));
		wrapper.when('rawGraphql', (call: { variables: Record<string, unknown> }): { data: unknown } => {
			const variables = call.variables;
			if (variables.offset === 0) {
				return { data: { data: { publicCrates: firstPage } } };
			}
			if (variables.offset === 200) {
				return {
					data: {
						data: {
							publicCrates: [
								{ id: 'p-late', name: 'Late Alpha Sync', category: 'Ops', description: 'd' },
							],
						},
					},
				};
			}
			return { data: { data: { publicCrates: [] } } };
		});
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1', source: 'public', search: 'alpha', limit: 1 }, ctx);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 2, 'search advances to the second publicCrates page');
		assert.deepStrictEqual(
			calls.map(call => (call.variables as { variables: Record<string, unknown> }).variables.offset),
			[0, 200],
			'publicCrates offsets advance by page size',
		);
		assert.ok(output.includes('Late Alpha Sync (p-late)'), 'match after first page is listed');
	});

	test('invalid source rejected with the valid set', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1', source: 'marketplace' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('marketplace'), 'error names the invalid value');
				assert.ok(err.message.includes('catalog'), 'error names valid value catalog');
				assert.ok(err.message.includes('public'), 'error names valid value public');
				return true;
			},
		);
		assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 0, 'no GraphQL call made');
	});

	test('GraphQL errors propagate', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: undefined,
				errors: [{ message: 'crate error' }],
			},
		});
		const cap = getCapability('buddy_search_crates');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('GraphQL error'), 'error includes GraphQL error prefix');
				return true;
			},
		);
	});
});
