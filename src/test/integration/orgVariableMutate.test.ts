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
import { ORG_VARIABLE_MUTATE_CAPABILITIES } from '../../capabilities/orgVariableMutateCapabilities';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

/**
 * Live verification for the org-variable write capabilities, opt-in behind
 * REWST_TEST_WRITE=1 and always scoped to the token's own primary org. Creates,
 * updates, and deletes a throwaway variable, asserting the update mutates in
 * place (no duplicate) and the delete removes it. Cleans up in teardown.
 */
function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = ORG_VARIABLE_MUTATE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

const BY_NAME = `query RbItestOrgVarByName($orgId: ID!, $name: String!) {
  orgVariables(where: { orgId: $orgId, name: $name }, maskSecrets: false) { id name value category cascade orgId }
}`;

const DELETE = `mutation RbItestDeleteOrgVar($id: ID!) { deleteOrgVariable(id: $id) }`;

suite('Integration: org variable write tools', function () {
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
		// getTestSession stores the validated cookie in secrets, so session.rawGraphql works.
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

	test('create -> update -> delete round-trips and updates in place', async () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const name = `RB_ITEST_${stamp}`.replace(/-/g, '_');
		let id: string | undefined;

		const byName = async () => {
			const { data, errors } = await session.rawGraphql(BY_NAME, { orgId: targetOrgId, name });
			if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
				throw new Error(`BY_NAME GraphQL error: ${JSON.stringify(errors)}`);
			}
			return ((data as { orgVariables?: { id: string; value?: string }[] } | undefined)?.orgVariables ?? []) as {
				id: string;
				value?: string;
			}[];
		};

		try {
			const created = JSON.parse(
				await cap('create_org_variable').run({ orgId: targetOrgId, name, value: 'created-value' }, ctx),
			);
			assert.strictEqual(created.status, 'created');
			id = created.id;
			console.log('[itest] created org variable', id);

			let rows = await byName();
			assert.strictEqual(rows.length, 1, 'exactly one variable after create');
			assert.strictEqual(rows[0].id, id);
			assert.strictEqual(rows[0].value, 'created-value');

			// Org guard (live): updating with a non-target managed orgId must be refused
			// before mutating. This only reads the variable; the other org is untouched.
			if (otherOrgId) {
				const guardCtx: CapabilityContext = { session, orgId: otherOrgId, sessions: [session] };
				await assert.rejects(
					() =>
						cap('update_org_variable').run({ orgId: otherOrgId, variableId: id, value: 'NOPE' }, guardCtx),
					/is not in org/,
				);
				console.log('[itest] org guard refused a cross-org update to', otherOrgId);
			}

			const updated = JSON.parse(
				await cap('update_org_variable').run(
					{ orgId: targetOrgId, variableId: id, value: 'updated-value' },
					ctx,
				),
			);
			assert.strictEqual(updated.status, 'updated');

			rows = await byName();
			assert.strictEqual(rows.length, 1, 'update must mutate in place, not create a duplicate');
			assert.strictEqual(rows[0].id, id);
			assert.strictEqual(rows[0].value, 'updated-value');

			const deleted = JSON.parse(
				await cap('delete_org_variable').run({ orgId: targetOrgId, variableId: id }, ctx),
			);
			assert.strictEqual(deleted.status, 'deleted');
			id = undefined;

			rows = await byName();
			assert.strictEqual(rows.length, 0, 'variable removed after delete');
			console.log('[itest] deleted org variable; target org clean');
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
