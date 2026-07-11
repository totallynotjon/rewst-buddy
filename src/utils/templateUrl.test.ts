import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { getTemplateURLParams } from './templateUrl';

const { suite, test, setup } = Mocha;

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';

suite('Unit: getTemplateURLParams', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('parses orgId, templateId and baseURL from a well-formed template URL', async () => {
		const params = await getTemplateURLParams(
			`https://app.rewst.io/organizations/${ORG_ID}/templates/${TEMPLATE_ID}`,
		);

		assert.strictEqual(params.orgId, ORG_ID);
		assert.strictEqual(params.templateId, TEMPLATE_ID);
		assert.strictEqual(params.baseURL.host, 'app.rewst.io');
	});

	test('rejects an undefined URL (user cancelled the input box)', async () => {
		await assert.rejects(() => getTemplateURLParams(undefined), /not a string/);
	});

	test('rejects an empty string URL', async () => {
		await assert.rejects(() => getTemplateURLParams(''), /not a string/);
	});

	test('rejects a string that is not a valid URL', async () => {
		await assert.rejects(() => getTemplateURLParams('not a url'), /Invalid URL/);
	});

	test('rejects a URL whose path does not match the templates pattern', async () => {
		await assert.rejects(() => getTemplateURLParams('https://app.rewst.io/something/else'), /path does not match/);
	});

	test('rejects a URL with a non-uuid org id', async () => {
		await assert.rejects(
			() => getTemplateURLParams(`https://app.rewst.io/organizations/not-a-uuid/templates/${TEMPLATE_ID}`),
			/Org ID in URL is not valid uuid/,
		);
	});

	test('rejects a URL with a non-uuid template id', async () => {
		await assert.rejects(
			() => getTemplateURLParams(`https://app.rewst.io/organizations/${ORG_ID}/templates/not-a-uuid`),
			/Template ID in URL is not valid uuid/,
		);
	});

	test('accepts query parameters and fragments copied from the Rewst app', async () => {
		const params = await getTemplateURLParams(
			`https://app.rewst.io/organizations/${ORG_ID}/templates/${TEMPLATE_ID}?tab=editor#body`,
		);
		assert.strictEqual(params.orgId, ORG_ID);
		assert.strictEqual(params.templateId, TEMPLATE_ID);
		assert.strictEqual(params.baseURL.search, '?tab=editor');
		assert.strictEqual(params.baseURL.hash, '#body');
	});

	test('accepts a harmless trailing slash after the template id', async () => {
		const params = await getTemplateURLParams(
			`https://app.rewst.io/organizations/${ORG_ID}/templates/${TEMPLATE_ID}/`,
		);
		assert.strictEqual(params.templateId, TEMPLATE_ID);
	});

	test('rejects extra path segments that could identify a different resource', async () => {
		await assert.rejects(
			() =>
				getTemplateURLParams(`https://app.rewst.io/organizations/${ORG_ID}/templates/${TEMPLATE_ID}/history/1`),
			/path does not match/,
		);
	});

	test('rejects non-http schemes even when their path has valid ids', async () => {
		for (const scheme of ['file', 'ftp', 'javascript']) {
			await assert.rejects(
				() => getTemplateURLParams(`${scheme}://app.rewst.io/organizations/${ORG_ID}/templates/${TEMPLATE_ID}`),
				// Must be rejected specifically for the disallowed scheme, not by any
				// generic URL error — no permissive `|URL` fallback.
				/scheme|protocol/i,
			);
		}
	});

	test('rejects URLs containing embedded credentials', async () => {
		await assert.rejects(
			() =>
				getTemplateURLParams(
					`https://user:password@app.rewst.io/organizations/${ORG_ID}/templates/${TEMPLATE_ID}`,
				),
			// Must be rejected specifically for embedded credentials (userinfo),
			// not by any generic URL error — no permissive `|URL` fallback.
			/credential|userinfo/i,
		);
	});

	test('accepts uppercase UUID hex without changing the captured ids', async () => {
		const upperOrg = ORG_ID.toUpperCase();
		const upperTemplate = TEMPLATE_ID.toUpperCase();
		const params = await getTemplateURLParams(
			`https://app.rewst.io/organizations/${upperOrg}/templates/${upperTemplate}`,
		);
		assert.strictEqual(params.orgId, upperOrg);
		assert.strictEqual(params.templateId, upperTemplate);
	});
});
