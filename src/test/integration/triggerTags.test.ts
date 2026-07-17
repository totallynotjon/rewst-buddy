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
import { TRIGGER_TAG_CAPABILITIES } from '../../capabilities/triggerTagCapabilities';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

/**
 * Live verification for buddy_get_trigger (read) and buddy_set_trigger_tags
 * (write). The read test runs whenever a sandbox token is present; the write
 * test is opt-in behind REWST_TEST_WRITE=1 and scoped to REWST_TEST_ORG_ID.
 * The write test adds a spare sandbox tag to a trigger and removes it again
 * (net-zero), restoring the original tag set in finally; it skips when the
 * sandbox has no trigger or no spare tag.
 */
function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = TRIGGER_TAG_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

const FIRST_TRIGGER = `query RbItestFirstTaggableTrigger($orgId: ID!) {
  triggers(where: { orgId: $orgId }, limit: 1) { id name orgId tags { id } }
}`;
const LIST_TAGS = `query RbItestTags($orgId: ID!) { tags(where: { orgId: $orgId }, limit: 50) { id } }`;
const RESTORE_TAGS = `mutation RbItestRestoreTags($trigger: TriggerUpdateInput!) {
  updateTrigger(trigger: $trigger, createPatch: true) { id }
}`;

suite('Integration: trigger tag tools', function () {
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

	test('buddy_get_trigger reads a trigger and surfaces tag ids', async function () {
		const { data, errors } = await session.rawGraphql(FIRST_TRIGGER, { orgId: targetOrgId });
		if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
			throw new Error(`FIRST_TRIGGER GraphQL error: ${JSON.stringify(errors)}`);
		}
		const trigger = (data as { triggers?: { id: string }[] } | undefined)?.triggers?.[0];
		if (!trigger) {
			console.log('[itest] no trigger in sandbox; skipping read');
			this.skip();
			return;
		}
		const output = JSON.parse(
			await cap('buddy_get_trigger').run({ orgId: targetOrgId, triggerId: trigger.id }, ctx),
		);
		assert.strictEqual(output.id, trigger.id);
		assert.ok(Array.isArray(output.tagIds), 'tagIds is an array');
		assert.ok(Array.isArray(output.activatedForOrgs), 'activatedForOrgs is an array');
		assert.ok(/not independently readable/i.test(output.notes), 'notes flag the unreadable input');
	});

	test('buddy_set_trigger_tags adds then removes a spare tag (net-zero)', async function () {
		if (!writeTestsEnabled()) {
			this.skip();
			return;
		}
		const { data, errors } = await session.rawGraphql(FIRST_TRIGGER, { orgId: targetOrgId });
		if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
			throw new Error(`FIRST_TRIGGER GraphQL error: ${JSON.stringify(errors)}`);
		}
		const trigger = (data as { triggers?: { id: string; tags?: { id: string }[] }[] } | undefined)?.triggers?.[0];
		if (!trigger) {
			console.log('[itest] no trigger in sandbox; skipping tag write');
			this.skip();
			return;
		}
		const originalTagIds = (trigger.tags ?? []).map(t => t.id);

		const tagsResp = await session.rawGraphql(LIST_TAGS, { orgId: targetOrgId });
		if (Array.isArray(tagsResp.errors) ? tagsResp.errors.length > 0 : tagsResp.errors != null) {
			throw new Error(`LIST_TAGS GraphQL error: ${JSON.stringify(tagsResp.errors)}`);
		}
		const allTagIds = ((tagsResp.data as { tags?: { id: string }[] } | undefined)?.tags ?? []).map(t => t.id);
		const spareTagId = allTagIds.find(id => !originalTagIds.includes(id));
		if (!spareTagId) {
			console.log('[itest] no spare tag in sandbox; skipping tag write');
			this.skip();
			return;
		}

		let dirty = false;
		try {
			// Marked dirty before the mutation: the write can land even if the
			// post-write reread or JSON parsing throws, and restoring an unchanged
			// tag set is safer than leaking a partial mutation.
			dirty = true;
			const added = JSON.parse(
				await cap('buddy_set_trigger_tags').run(
					{ orgId: targetOrgId, triggerId: trigger.id, operation: 'add', tagIds: [spareTagId] },
					ctx,
				),
			);
			assert.strictEqual(added.status, 'updated');
			assert.ok(added.tagIds.after.includes(spareTagId), 'spare tag is present after add');
			for (const id of originalTagIds) {
				assert.ok(added.tagIds.after.includes(id), `existing tag ${id} was not dropped by add`);
			}

			const removed = JSON.parse(
				await cap('buddy_set_trigger_tags').run(
					{ orgId: targetOrgId, triggerId: trigger.id, operation: 'remove', tagIds: [spareTagId] },
					ctx,
				),
			);
			assert.ok(!removed.tagIds.after.includes(spareTagId), 'spare tag is gone after remove');
			assert.deepStrictEqual(
				[...removed.tagIds.after].sort(),
				[...originalTagIds].sort(),
				'restored original tags',
			);
			dirty = false;
			console.log('[itest] add/remove tag round-trip complete');
		} finally {
			if (dirty) {
				const { errors: restoreErrors } = await session
					.rawGraphql(RESTORE_TAGS, { trigger: { id: trigger.id, activatedForTagIds: originalTagIds } })
					.catch((e: unknown) => ({ errors: [String(e)] }));
				if (Array.isArray(restoreErrors) ? restoreErrors.length > 0 : restoreErrors != null) {
					console.warn(`[itest] restore tags failed: ${JSON.stringify(restoreErrors)}`);
				}
			}
		}
	});
});
