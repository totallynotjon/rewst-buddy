import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { Session } from '@sessions';
import type { CapabilityContext } from './Capability';
import { PAGE_TEMPLATE_CAPABILITIES } from './pageTemplateCapabilities';
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
	const c = PAGE_TEMPLATE_CAPABILITIES.find(x => x.spec.name === name);
	if (!c) throw new Error('missing ' + name);
	return c;
}
suite('Unit: pageTemplateCapabilities', () => {
	setup(() => initTestEnvironment());

	test('search_templates maps name search and formats template rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				templates: [
					{
						id: 't1',
						name: 'Foo',
						language: 'JINJA',
						contentType: 'text/plain',
						updatedAt: '2024-01-01',
					},
				],
			},
		});

		const output = await cap('search_templates').run({ orgId: 'org-1', search: 'foo', limit: 10 }, ctx);

		assert.ok(calls[0].query.includes('templates('));
		assert.deepStrictEqual(calls[0].variables.search, { name: { _ilike: '%foo%' } });
		assert.ok(output.includes('Foo'));
	});

	test('list_pages uses pages query and formats page rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: { pages: [{ id: 'p1', name: 'Home', path: 'home', siteId: 's1' }] },
		});

		const output = await cap('list_pages').run({ orgId: 'org-1' }, ctx);

		assert.ok(calls[0].query.includes('pages('));
		assert.ok(output.includes('Home (p1)'));
	});

	test('list_sites uses sites query without pagination and formats live state', async () => {
		const { ctx, calls } = fakeCtx({
			data: { sites: [{ id: 's1', name: 'My Site', domain: 'example.com', isLive: true }] },
		});

		const output = await cap('list_sites').run({ orgId: 'org-1' }, ctx);

		assert.ok(calls[0].query.includes('sites('));
		assert.ok(!calls[0].query.includes('limit'));
		assert.ok(output.includes('[live]'));
	});

	test('list_jinja_filters filters the global catalog client-side', async () => {
		const { ctx } = fakeCtx({
			data: {
				jinjaFiltersDocumentation: [
					{ name: 'default', signature: 'default(value, default_value)' },
					{ name: 'abs', signature: 'abs(x)' },
				],
			},
		});

		const output = await cap('list_jinja_filters').run({ orgId: 'org-1', search: 'abs' }, ctx);

		assert.ok(output.includes('abs'));
		assert.ok(!output.includes('default'));
	});

	test('search_templates reports GraphQL errors with details', async () => {
		const { ctx } = fakeCtx({
			errors: [{ message: 'boom' }],
		});

		await assert.rejects(
			() => cap('search_templates').run({ orgId: 'org-1' }, ctx),
			/GraphQL error: \[{"message":"boom"}\]/,
		);
	});
});
