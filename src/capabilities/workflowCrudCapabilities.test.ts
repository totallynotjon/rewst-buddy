import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import {
	_resetMcpMutationApproverForTesting,
	setMcpMutationApprover,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import type { Session } from '@sessions';
import { _resetApprovedMutationScopes } from '../ui/chat/tools/graphqlTool';
import { WORKFLOW_CRUD_CAPABILITIES } from './workflowCrudCapabilities';

const { suite, test, setup, teardown } = Mocha;

function cap(name: string): Capability {
	const capability = WORKFLOW_CRUD_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

interface GraphqlResult {
	data?: unknown;
	errors?: unknown;
}
type Op = 'owner' | 'create' | 'delete';
type OpResponses = Partial<Record<Op, GraphqlResult>>;

function routeOp(query: string): Op | 'unknown' {
	if (query.includes('WorkflowOwner')) return 'owner';
	if (query.includes('CreateWorkflow')) return 'create';
	if (query.includes('DeleteWorkflow')) return 'delete';
	return 'unknown';
}

function makeCtx(responses: OpResponses, orgId = 'org-sandbox', orgName = 'Sandbox') {
	const calls: { op: string; variables: Record<string, unknown> | undefined }[] = [];
	const session = {
		profile: { org: { id: orgId, name: orgName }, allManagedOrgs: [{ id: orgId, name: orgName }] },
		rawGraphql: async (query: string, variables?: Record<string, unknown>) => {
			const op = routeOp(query);
			calls.push({ op, variables });
			const r = responses[op as keyof OpResponses];
			if (!r) throw new Error(`no mock configured for op "${op}"`);
			return r;
		},
	} as unknown as Session;
	const ctx: CapabilityContext = { session, orgId, sessions: [session] };
	return { ctx, calls };
}

function callsFor(calls: { op: string; variables: Record<string, unknown> | undefined }[], op: string) {
	return calls.filter(c => c.op === op);
}

suite('Unit: workflowCrudCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	suite('buddy_create_workflow', () => {
		test('is a write capability gated by approval, mcp-only', () => {
			const c = cap('buddy_create_workflow');
			assert.strictEqual(c.access, 'write');
			assert.strictEqual(c.mcp, true);
			assert.strictEqual(c.chat, false);
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('creates an empty workflow when approved', async () => {
			const { ctx, calls } = makeCtx({ create: { data: { createWorkflow: { id: 'w1', name: 'Onboard' } } } });
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_create_workflow').run({ orgId: 'org-sandbox', name: 'Onboard' }, ctx);

			assert.deepStrictEqual(callsFor(calls, 'create')[0].variables, {
				workflow: { orgId: 'org-sandbox', name: 'Onboard' },
			});
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.status, 'created');
			assert.strictEqual(parsed.id, 'w1');
		});

		test('forwards a description when provided', async () => {
			const { ctx, calls } = makeCtx({ create: { data: { createWorkflow: { id: 'w2', name: 'Wf' } } } });
			setMcpMutationApprover(async () => true);

			await cap('buddy_create_workflow').run(
				{ orgId: 'org-sandbox', name: 'Wf', description: 'does things' },
				ctx,
			);

			const wf = (callsFor(calls, 'create')[0].variables as { workflow: Record<string, unknown> }).workflow;
			assert.strictEqual(wf.description, 'does things');
		});

		test('rejects a missing name', async () => {
			const { ctx } = makeCtx({});
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_workflow').run({ orgId: 'org-sandbox' }, ctx),
				/Missing required string argument "name"/,
			);
		});

		test('does not create when approval is denied', async () => {
			const { ctx, calls } = makeCtx({});
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_create_workflow').run({ orgId: 'org-sandbox', name: 'Onboard' }, ctx);

			assert.strictEqual(callsFor(calls, 'create').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});
	});

	suite('buddy_delete_workflow', () => {
		const inOrg = { data: { workflow: { id: 'w1', name: 'Onboard', orgId: 'org-sandbox' } } };

		test('deletes when in-org and approved', async () => {
			const { ctx, calls } = makeCtx({ owner: inOrg, delete: { data: { deleteWorkflow: 'w1' } } });
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_delete_workflow').run({ orgId: 'org-sandbox', workflowId: 'w1' }, ctx);

			assert.deepStrictEqual(callsFor(calls, 'delete')[0].variables, { id: 'w1' });
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.status, 'deleted');
			assert.strictEqual(parsed.id, 'w1');
		});

		test('refuses to delete a workflow in another org', async () => {
			const { ctx, calls } = makeCtx({
				owner: { data: { workflow: { id: 'w1', name: 'X', orgId: 'org-OTHER' } } },
			});
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_delete_workflow').run({ orgId: 'org-sandbox', workflowId: 'w1' }, ctx),
				/Workflow w1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'delete').length, 0);
		});

		test('refuses when the workflow does not exist', async () => {
			const { ctx, calls } = makeCtx({ owner: { data: { workflow: null } } });
			setMcpMutationApprover(async () => true);

			await assert.rejects(
				() => cap('buddy_delete_workflow').run({ orgId: 'org-sandbox', workflowId: 'w1' }, ctx),
				/Workflow w1 is not in org org-sandbox/,
			);
			assert.strictEqual(callsFor(calls, 'delete').length, 0);
		});

		test('does not delete when approval is denied', async () => {
			const { ctx, calls } = makeCtx({ owner: inOrg });
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_delete_workflow').run({ orgId: 'org-sandbox', workflowId: 'w1' }, ctx);

			assert.strictEqual(callsFor(calls, 'delete').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});
	});

	suite('error and empty-result branches', () => {
		const inOrg = { data: { workflow: { id: 'w1', name: 'Onboard', orgId: 'org-sandbox' } } };

		test('create surfaces GraphQL errors', async () => {
			const { ctx } = makeCtx({ create: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_workflow').run({ orgId: 'org-sandbox', name: 'X' }, ctx),
				/GraphQL error/,
			);
		});

		test('create throws when no workflow is returned', async () => {
			const { ctx } = makeCtx({ create: { data: { createWorkflow: {} } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_workflow').run({ orgId: 'org-sandbox', name: 'X' }, ctx),
				/returned no workflow/,
			);
		});

		test('delete surfaces a pre-flight GraphQL error', async () => {
			const { ctx } = makeCtx({ owner: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_delete_workflow').run({ orgId: 'org-sandbox', workflowId: 'w1' }, ctx),
				/GraphQL error/,
			);
		});

		test('delete throws when no id is returned', async () => {
			const { ctx } = makeCtx({ owner: inOrg, delete: { data: { deleteWorkflow: null } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_delete_workflow').run({ orgId: 'org-sandbox', workflowId: 'w1' }, ctx),
				/returned no id/,
			);
		});
	});
});
