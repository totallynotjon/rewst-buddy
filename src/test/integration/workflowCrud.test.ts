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
import { WORKFLOW_CRUD_CAPABILITIES } from '../../capabilities/workflowCrudCapabilities';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

/**
 * Live verification for create_workflow / delete_workflow, opt-in behind
 * REWST_TEST_WRITE=1 and scoped to the token's own primary org. Creates an empty
 * workflow and deletes it; cleans up in teardown.
 */
function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = WORKFLOW_CRUD_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

const BY_ID = `query RbItestWorkflowById($id: ID!) { workflow(where: { id: $id }) { id name orgId } }`;
const DELETE = `mutation RbItestDeleteWorkflow($id: ID!) { deleteWorkflow(id: $id) }`;

suite('Integration: workflow CRUD tools', function () {
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

	test('create -> delete round-trips in the target org', async () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const name = `rb-itest-${stamp}`;
		let id: string | undefined;

		const byId = async (workflowId: string) => {
			const { data, errors } = await session.rawGraphql(BY_ID, { id: workflowId });
			if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
				throw new Error(`BY_ID GraphQL error: ${JSON.stringify(errors)}`);
			}
			return (data as { workflow?: { id: string; orgId?: string } | null } | undefined)?.workflow ?? null;
		};

		try {
			const created = JSON.parse(await cap('create_workflow').run({ orgId: targetOrgId, name }, ctx));
			assert.strictEqual(created.status, 'created');
			id = created.id;
			console.log('[itest] created workflow', id);

			const wf = await byId(id!);
			assert.ok(wf, 'workflow exists after create');
			assert.strictEqual(wf!.orgId, targetOrgId, 'created workflow is in the target org');

			if (otherOrgId) {
				const guardCtx: CapabilityContext = { session, orgId: otherOrgId, sessions: [session] };
				await assert.rejects(
					() => cap('delete_workflow').run({ orgId: otherOrgId, workflowId: id }, guardCtx),
					/is not in org/,
				);
				assert.ok(await byId(id!), 'workflow still present after refused cross-org delete');
				console.log('[itest] org guard refused a cross-org delete to', otherOrgId);
			}

			const deleted = JSON.parse(await cap('delete_workflow').run({ orgId: targetOrgId, workflowId: id }, ctx));
			assert.strictEqual(deleted.status, 'deleted');
			id = undefined;

			assert.strictEqual(await byId(created.id), null, 'workflow removed after delete');
			console.log('[itest] deleted workflow; target org clean');
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
