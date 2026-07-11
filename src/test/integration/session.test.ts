import * as assert from 'assert';
import * as Mocha from 'mocha';
import { Session } from '@sessions';
import { hasTestToken, getTestOrgId, getTestSession, getTestSdk, clearCachedSession, initTestEnvironment } from '@test';
import { randomUUID } from 'crypto';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

suite('Integration: Session', function () {
	// Integration tests may take longer due to network calls
	this.timeout(30000);

	suiteSetup(function () {
		if (!hasTestToken()) {
			this.skip();
		}
		// Session.newSdk logs through the extension's log channel; initialize it
		// (and the mock context/globals) so those calls don't crash.
		initTestEnvironment();
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	suite('Session.newSdk()', () => {
		test('should create SDK from valid token', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}

			const token = process.env.REWST_TEST_TOKEN!;
			const [sdk, regionConfig, cookieString] = await Session.newSdk(token);

			assert.ok(sdk, 'SDK should be created');
			assert.ok(regionConfig, 'Region config should be returned');
			assert.ok(regionConfig.name, 'Region should have a name');
			assert.ok(cookieString, 'Cookie string should be returned');
		});

		test('should fail with invalid token', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}

			try {
				await Session.newSdk('invalid-token-that-should-not-work');
				assert.fail('Should have thrown an error');
			} catch (error) {
				// Expected to fail
				assert.ok(error instanceof Error);
			}
		});
	});

	suite('SDK User Query', () => {
		test('should fetch current user', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}

			const sdk = await getTestSdk();
			const response = await sdk.User();

			assert.ok(response.user, 'User should be returned');
			assert.ok(response.user.id, 'User should have an ID');
			assert.ok(response.user.orgId, 'User should have an orgId');
		});
	});

	suite('Session Validation', () => {
		test('should validate session successfully', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}

			const session = await getTestSession();
			const isValid = await session.validate();

			assert.strictEqual(isValid, true, 'Session should be valid');
		});

		test('should expose only the configured sandbox in the integration profile tree', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}
			const session = await getTestSession();
			const orgId = getTestOrgId();
			assert.strictEqual(session.profile.org.id, orgId);
			assert.deepStrictEqual(
				session.profile.allManagedOrgs.map(org => org.id),
				[orgId],
			);
			assert.strictEqual(session.profile.user.orgId, orgId);
		});

		test('should fail closed when REWST_TEST_ORG_ID is not managed instead of using the token primary org', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}
			const original = process.env.REWST_TEST_ORG_ID;
			const unavailable = randomUUID();
			clearCachedSession();
			process.env.REWST_TEST_ORG_ID = unavailable;
			try {
				await assert.rejects(
					() => getTestSession(),
					new RegExp(`REWST_TEST_ORG_ID ${unavailable} is not managed.*No fallback`, 's'),
				);
			} finally {
				if (original === undefined) delete process.env.REWST_TEST_ORG_ID;
				else process.env.REWST_TEST_ORG_ID = original;
				clearCachedSession();
			}
		});

		test('should keep raw GraphQL workflow reads inside the configured sandbox filter', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}
			const session = await getTestSession();
			const orgId = getTestOrgId();
			const { data, errors } = await session.rawGraphql(
				'query RbItestScopedSessionRead($orgId: ID!) { workflows(where: { orgId: $orgId }, limit: 10) { id orgId } }',
				{ orgId },
			);
			assert.ok(!errors || (Array.isArray(errors) && errors.length === 0), JSON.stringify(errors));
			const rows = (data as { workflows?: { id: string; orgId: string }[] } | undefined)?.workflows ?? [];
			assert.ok(
				rows.every(row => row.orgId === orgId),
				JSON.stringify(rows),
			);
		});
	});

	suite('Template Operations', () => {
		test('should list templates', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}

			const session = await getTestSession();
			const sdk = await getTestSdk();
			const response = await sdk.listTemplates({ orgId: session.profile.org.id });

			assert.ok(response.templates, 'Templates response should exist');
			assert.ok(Array.isArray(response.templates), 'Templates should be an array');
		});

		test('should fetch specific template if available', async function () {
			if (!hasTestToken()) {
				this.skip();
				return;
			}

			const session = await getTestSession();
			const sdk = await getTestSdk();

			// First, get a template ID from the list
			const listResponse = await sdk.listTemplates({ orgId: session.profile.org.id });
			const templates = listResponse.templates ?? [];

			if (templates.length === 0) {
				// No templates available to test
				this.skip();
				return;
			}

			const templateId = templates[0]?.id;
			if (!templateId) {
				this.skip();
				return;
			}

			const template = await session.getTemplate(templateId);

			assert.ok(template, 'Template should be fetched');
			assert.strictEqual(template.id, templateId, 'Template ID should match');
			assert.ok(template.name, 'Template should have a name');
		});
	});
});
