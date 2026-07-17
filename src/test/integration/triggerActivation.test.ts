import * as assert from 'assert';
import * as Mocha from 'mocha';
import { Session } from '@sessions';
import { clearCachedSession, getTestOrgId, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import {
	_resetMcpMutationApproverForTesting,
	setMcpMutationApprover,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import { _resetApprovedMutationScopes } from '../../ui/chat/tools/graphqlTool';
import { TRIGGER_ACTIVATION_CAPABILITIES } from '../../capabilities/triggerActivationCapabilities';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

/**
 * Live verification for buddy_set_trigger_activation. Opt-in behind
 * REWST_TEST_WRITE=1 and scoped to REWST_TEST_ORG_ID. The write test flips the
 * trigger's autoActivateManagedOrgs to its inverse and back (net-zero),
 * restoring the original value in finally; it skips when the sandbox has no
 * trigger. It deliberately does not add/remove org activations, since a sandbox
 * has no disposable sub-org to activate safely.
 */
function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = TRIGGER_ACTIVATION_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

const FIRST_TRIGGER = `query RbItestFirstActivationTrigger($orgId: ID!) {
  triggers(where: { orgId: $orgId }, limit: 1) { id name orgId autoActivateManagedOrgs }
}`;
const RESTORE_AUTO = `mutation RbItestRestoreAuto($trigger: TriggerUpdateInput!) {
  updateTrigger(trigger: $trigger, createPatch: true) { id }
}`;

suite('Integration: trigger activation tools', function () {
	this.timeout(120_000);

	let session: Session;
	let ctx: CapabilityContext;
	let targetOrgId: string;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();
		// getTestSession fails closed unless the token manages this exact org, but
		// every API variable still targets the configured sandbox id explicitly.
		targetOrgId = getTestOrgId();
		if (session.profile.org.id !== targetOrgId) {
			throw new Error('Refusing to run: the test session is not bound to the configured sandbox org.');
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

	test('buddy_set_trigger_activation flips autoActivateManagedOrgs and back (net-zero)', async function () {
		if (!writeTestsEnabled()) {
			this.skip();
			return;
		}
		const { data, errors } = await session.rawGraphql(FIRST_TRIGGER, { orgId: targetOrgId });
		if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
			throw new Error(`FIRST_TRIGGER GraphQL error: ${JSON.stringify(errors)}`);
		}
		const trigger = (data as { triggers?: { id: string; autoActivateManagedOrgs?: boolean }[] } | undefined)
			?.triggers?.[0];
		if (!trigger) {
			console.log('[itest] no trigger in sandbox; skipping activation write');
			this.skip();
			return;
		}
		const original = trigger.autoActivateManagedOrgs === true;

		let dirty = false;
		try {
			// Marked dirty before the mutation: the write can land even if the
			// post-write reread or JSON parsing throws, and restoring the original
			// value is safer than leaking a partial mutation.
			dirty = true;
			const flipped = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: targetOrgId, triggerId: trigger.id, autoActivateManagedOrgs: !original },
					ctx,
				),
			);
			assert.strictEqual(flipped.status, 'updated');
			assert.strictEqual(flipped.autoActivateManagedOrgs.after, !original);

			const restored = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: targetOrgId, triggerId: trigger.id, autoActivateManagedOrgs: original },
					ctx,
				),
			);
			assert.strictEqual(restored.autoActivateManagedOrgs.after, original);
			dirty = false;
			console.log('[itest] autoActivateManagedOrgs flip round-trip complete');
		} finally {
			if (dirty) {
				const { errors: restoreErrors } = await session
					.rawGraphql(RESTORE_AUTO, {
						trigger: { id: trigger.id, autoActivateManagedOrgs: original },
					})
					.catch((e: unknown) => ({ errors: [String(e)] }));
				if (Array.isArray(restoreErrors) ? restoreErrors.length > 0 : restoreErrors != null) {
					console.warn(`[itest] restore autoActivate failed: ${JSON.stringify(restoreErrors)}`);
				}
			}
		}
	});
});
