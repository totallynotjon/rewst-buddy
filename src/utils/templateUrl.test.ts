import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
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
});
