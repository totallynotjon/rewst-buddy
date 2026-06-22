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
import { TRIGGER_MUTATE_CAPABILITIES } from '../../capabilities/triggerMutateCapabilities';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

/**
 * Live verification for set_trigger_enabled, opt-in behind REWST_TEST_WRITE=1 and
 * scoped to the token's own primary org. Toggles an existing sandbox trigger to
 * the opposite state and restores it (net-zero); skips if the org has no trigger.
 */
function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = TRIGGER_MUTATE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

const FIRST_TRIGGER = `query RbItestFirstTrigger($orgId: ID!) {
  triggers(where: { orgId: $orgId }, limit: 1) { id name enabled orgId }
}`;
const RESTORE = `mutation RbItestRestoreTrigger($trigger: TriggerUpdateInput!) {
  updateTrigger(trigger: $trigger) { id enabled }
}`;

suite('Integration: trigger write tools', function () {
	this.timeout(120_000);

	let session: Session;
	let ctx: CapabilityContext;
	let targetOrgId: string;
	let otherOrgId: string | undefined;

	suiteSetup(async function () {
		if (!writeTestsEnabled()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();
		targetOrgId = session.profile.org.id;
		if (!targetOrgId) throw new Error('Refusing to run: the test session has no primary org id.');
		otherOrgId = session.profile.allManagedOrgs.find(org => org.id && org.id !== targetOrgId)?.id;
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

	test('toggles an existing trigger and restores it', async function () {
		const { data } = await session.rawGraphql(FIRST_TRIGGER, { orgId: targetOrgId });
		const trigger = (data as { triggers?: { id: string; enabled?: boolean }[] } | undefined)?.triggers?.[0];
		if (!trigger) {
			console.log('[itest] no trigger in sandbox; skipping toggle');
			this.skip();
			return;
		}
		const original = trigger.enabled ?? false;
		const triggerId = trigger.id;
		let changed = false;

		try {
			if (otherOrgId) {
				const guardCtx: CapabilityContext = { session, orgId: otherOrgId, sessions: [session] };
				await assert.rejects(
					() =>
						cap('set_trigger_enabled').run({ orgId: otherOrgId, triggerId, enabled: !original }, guardCtx),
					/is not in org/,
				);
				console.log('[itest] org guard refused a cross-org toggle to', otherOrgId);
			}

			const toggled = JSON.parse(
				await cap('set_trigger_enabled').run({ orgId: targetOrgId, triggerId, enabled: !original }, ctx),
			);
			changed = true;
			assert.strictEqual(toggled.status, !original ? 'enabled' : 'disabled');
			console.log('[itest] toggled trigger', triggerId, '->', toggled.status);

			const restored = JSON.parse(
				await cap('set_trigger_enabled').run({ orgId: targetOrgId, triggerId, enabled: original }, ctx),
			);
			changed = false;
			assert.strictEqual(restored.status, original ? 'enabled' : 'disabled');
			console.log('[itest] restored trigger to original state');
		} finally {
			if (changed) {
				try {
					await session.rawGraphql(RESTORE, { trigger: { id: triggerId, enabled: original } });
				} catch {
					// best-effort restore
				}
			}
		}
	});
});
