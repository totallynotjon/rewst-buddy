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
import { TAG_MUTATE_CAPABILITIES } from '../../capabilities/tagMutateCapabilities';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

/**
 * Live verification for the tag write capabilities, opt-in behind
 * REWST_TEST_WRITE=1 and scoped to the token's own primary org. Creates, updates,
 * and deletes a throwaway tag; cleans up in teardown.
 */
function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = TAG_MUTATE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

const BY_ID = `query RbItestTagById($orgId: ID!, $id: ID!) {
  tags(where: { orgId: $orgId, id: $id }) { id name color orgId }
}`;

const DELETE = `mutation RbItestDeleteTag($id: ID!) { deleteTag(id: $id) }`;

suite('Integration: tag write tools', function () {
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

	test('create -> update -> delete round-trips in the target org', async () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const name = `rb-itest-${stamp}`;
		let id: string | undefined;

		const byId = async (tagId: string) => {
			const { data, errors } = await session.rawGraphql(BY_ID, { orgId: targetOrgId, id: tagId });
			if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
				throw new Error(`BY_ID GraphQL error: ${JSON.stringify(errors)}`);
			}
			return ((data as { tags?: { id: string; name?: string; color?: string }[] } | undefined)?.tags ?? []) as {
				id: string;
				name?: string;
				color?: string;
			}[];
		};

		try {
			const created = JSON.parse(
				await cap('create_tag').run({ orgId: targetOrgId, name, color: '#4287f5' }, ctx),
			);
			assert.strictEqual(created.status, 'created');
			id = created.id;
			console.log('[itest] created tag', id);

			let rows = await byId(id!);
			assert.strictEqual(rows.length, 1);
			assert.strictEqual(rows[0].name, name);
			assert.strictEqual(rows[0].color, '#4287f5');

			if (otherOrgId) {
				const guardCtx: CapabilityContext = { session, orgId: otherOrgId, sessions: [session] };
				await assert.rejects(
					() => cap('update_tag').run({ orgId: otherOrgId, tagId: id, name: 'NOPE' }, guardCtx),
					/is not in org/,
				);
				console.log('[itest] org guard refused a cross-org update to', otherOrgId);
			}

			const updated = JSON.parse(
				await cap('update_tag').run({ orgId: targetOrgId, tagId: id, color: '#f54242' }, ctx),
			);
			assert.strictEqual(updated.status, 'updated');

			rows = await byId(id!);
			assert.strictEqual(rows[0].color, '#f54242');
			assert.strictEqual(rows[0].name, name, 'name preserved when only color changes');

			const deleted = JSON.parse(await cap('delete_tag').run({ orgId: targetOrgId, tagId: id }, ctx));
			assert.strictEqual(deleted.status, 'deleted');
			id = undefined;

			rows = await byId(created.id);
			assert.strictEqual(rows.length, 0, 'tag removed after delete');
			console.log('[itest] deleted tag; target org clean');
		} finally {
			if (id) {
				try {
					await session.rawGraphql(DELETE, { id });
				} catch {
					// best-effort cleanup
				}
			}
		}
	});
});
