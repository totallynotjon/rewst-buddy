import * as assert from 'assert';
import * as Mocha from 'mocha';
import { Session } from '@sessions';
import { clearCachedSession, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import {
	_resetMcpMutationApproverForTesting,
	setMcpMutationApprover,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import { _resetApprovedMutationScopes } from '../../ui/chat/tools/graphqlTool';
import { TEMPLATE_MUTATE_CAPABILITIES } from '../../capabilities/templateMutateCapabilities';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

/**
 * Live verification for the template write capabilities. These create and delete
 * a real, throwaway template, so the suite is opt-in: it runs only when a token
 * is present AND REWST_TEST_WRITE=1, and it always targets REWST_TEST_ORG_ID.
 * The template is removed in teardown even if an assertion fails.
 */
function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = TEMPLATE_MUTATE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

suite('Integration: template write tools', function () {
	this.timeout(120_000);

	let session: Session;
	let ctx: CapabilityContext;
	let targetOrgId: string;

	suiteSetup(async function () {
		if (!writeTestsEnabled()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();

		targetOrgId = session.profile.org.id;
		if (!targetOrgId) {
			throw new Error('Refusing to run: the test session has no sandbox org id.');
		}
		ctx = { session, orgId: targetOrgId, sessions: [session] };

		console.log(`\n[itest] target org: ${session.profile.org.name} (${targetOrgId})`);
	});

	setup(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		setMcpMutationApprover(async () => true);
	});

	suiteTeardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		clearCachedSession();
	});

	test('create -> update body -> rename -> delete round-trips in the target org', async () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const initialName = `rb-itest-${stamp}`;
		let templateId: string | undefined;

		try {
			const created = JSON.parse(
				await cap('buddy_create_template').run(
					{ orgId: targetOrgId, name: initialName, body: '{{ 1 + 1 }}' },
					ctx,
				),
			);
			assert.strictEqual(created.status, 'created');
			assert.ok(created.id, 'create returned an id');
			templateId = created.id;

			console.log('[itest] created template', templateId);

			const fetched = await session.getTemplate(templateId!);
			assert.strictEqual(fetched.orgId, targetOrgId, 'created template is in the target org');
			assert.strictEqual(fetched.body, '{{ 1 + 1 }}');

			const updated = JSON.parse(
				await cap('buddy_update_template_body').run(
					{ orgId: targetOrgId, templateId, body: '{{ 2 + 2 }}' },
					ctx,
				),
			);
			assert.strictEqual(updated.status, 'updated');
			assert.strictEqual((await session.getTemplate(templateId!)).body, '{{ 2 + 2 }}');

			const renamed = JSON.parse(
				await cap('buddy_rename_template').run(
					{ orgId: targetOrgId, templateId, name: `${initialName}-renamed` },
					ctx,
				),
			);
			assert.strictEqual(renamed.status, 'renamed');
			assert.strictEqual((await session.getTemplate(templateId!)).name, `${initialName}-renamed`);

			const deleted = JSON.parse(await cap('buddy_delete_template').run({ orgId: targetOrgId, templateId }, ctx));
			assert.strictEqual(deleted.status, 'deleted');
			assert.strictEqual(deleted.id, templateId);
			templateId = undefined;

			console.log('[itest] deleted template; target org clean');
		} finally {
			if (templateId) {
				try {
					await session.sdk?.deleteTemplate({ id: templateId });
				} catch {
					// best-effort cleanup
				}
			}
		}
	});
});
