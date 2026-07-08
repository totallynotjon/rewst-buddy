import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { PAGE_TEMPLATE_CAPABILITIES } from './pageTemplateCapabilities';
const { suite, test, setup } = Mocha;
const { fakeCtx, cap } = createCapabilityTestHarness(PAGE_TEMPLATE_CAPABILITIES);
suite('Unit: pageTemplateCapabilities', () => {
	setup(() => initTestEnvironment());

	// --- Zod parse tests ---
	test('missing orgId throws before GraphQL for buddy_search_templates', async () => {
		const { ctx } = fakeCtx({ data: {} });
		await assert.rejects(() => cap('buddy_search_templates').run({}, ctx), /orgId/);
	});

	test('non-number limit falls back to default for buddy_search_templates (no throw)', async () => {
		const { ctx } = fakeCtx({ data: { templates: [] } });
		await assert.doesNotReject(() => cap('buddy_search_templates').run({ orgId: 'org-1', limit: 'bad' }, ctx));
	});

	test('over-max limit is clamped to 200 for buddy_list_pages', async () => {
		const { ctx, calls } = fakeCtx({ data: { pages: [] } });
		await cap('buddy_list_pages').run({ orgId: 'org-1', limit: 9999 }, ctx);
		assert.strictEqual(calls[0].variables!.limit, 200);
	});

	test('buddy_search_templates derived schema has orgId required and args generated', () => {
		const schema = cap('buddy_search_templates').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.strictEqual(cap('buddy_search_templates').spec.args, JSON.stringify(schema));
	});

	test('buddy_search_templates maps name search and formats template rows', async () => {
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

		const output = await cap('buddy_search_templates').run({ orgId: 'org-1', search: 'foo', limit: 10 }, ctx);

		assert.ok(calls[0].query.includes('templates('));
		assert.deepStrictEqual(calls[0].variables!.search, { name: { _ilike: '%foo%' } });
		assert.ok(output.includes('Foo'));
	});

	test('buddy_list_pages uses pages query and formats page rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: { pages: [{ id: 'p1', name: 'Home', path: 'home', siteId: 's1' }] },
		});

		const output = await cap('buddy_list_pages').run({ orgId: 'org-1' }, ctx);

		assert.ok(calls[0].query.includes('pages('));
		assert.ok(output.includes('Home (p1)'));
	});

	test('buddy_list_sites uses sites query without pagination and formats live state', async () => {
		const { ctx, calls } = fakeCtx({
			data: { sites: [{ id: 's1', name: 'My Site', domain: 'example.com', isLive: true }] },
		});

		const output = await cap('buddy_list_sites').run({ orgId: 'org-1' }, ctx);

		assert.ok(calls[0].query.includes('sites('));
		assert.ok(!calls[0].query.includes('limit'));
		assert.ok(output.includes('[live]'));
	});

	test('buddy_search_templates reports GraphQL errors with details', async () => {
		const { ctx } = fakeCtx({
			errors: [{ message: 'boom' }],
		});

		await assert.rejects(
			() => cap('buddy_search_templates').run({ orgId: 'org-1' }, ctx),
			/GraphQL error: \[{"message":"boom"}\]/,
		);
	});
});
