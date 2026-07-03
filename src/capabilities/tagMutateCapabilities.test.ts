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
import { TAG_MUTATE_CAPABILITIES } from './tagMutateCapabilities';

const { suite, test, setup, teardown } = Mocha;

function cap(name: string): Capability {
	const capability = TAG_MUTATE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

interface GraphqlResult {
	data?: unknown;
	errors?: unknown;
}
type Op = 'byId' | 'create' | 'update' | 'delete';
type OpResponses = Partial<Record<Op, GraphqlResult>>;

function routeOp(query: string): Op | 'unknown' {
	if (query.includes('TagById')) return 'byId';
	if (query.includes('CreateTag')) return 'create';
	if (query.includes('UpdateTag')) return 'update';
	if (query.includes('DeleteTag')) return 'delete';
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

suite('Unit: tagMutateCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	suite('buddy_create_tag', () => {
		test('is a write capability gated by approval, mcp-only', () => {
			const c = cap('buddy_create_tag');
			assert.strictEqual(c.access, 'write');
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('creates with only the required fields when approved', async () => {
			const { ctx, calls } = makeCtx({ create: { data: { createTag: { id: 'g1', name: 'prod' } } } });
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_create_tag').run({ orgId: 'org-sandbox', name: 'prod' }, ctx);

			assert.deepStrictEqual(callsFor(calls, 'create')[0].variables, {
				tag: { orgId: 'org-sandbox', name: 'prod' },
			});
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.status, 'created');
			assert.strictEqual(parsed.id, 'g1');
		});

		test('forwards color and description when provided', async () => {
			const { ctx, calls } = makeCtx({ create: { data: { createTag: { id: 'g2', name: 'env' } } } });
			setMcpMutationApprover(async () => true);

			await cap('buddy_create_tag').run(
				{ orgId: 'org-sandbox', name: 'env', color: '#4287f5', description: 'environment tag' },
				ctx,
			);

			const tag = (callsFor(calls, 'create')[0].variables as { tag: Record<string, unknown> }).tag;
			assert.strictEqual(tag.color, '#4287f5');
			assert.strictEqual(tag.description, 'environment tag');
		});

		test('rejects a missing name', async () => {
			const { ctx } = makeCtx({});
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_tag').run({ orgId: 'org-sandbox' }, ctx),
				/Missing required string argument "name"/,
			);
		});

		test('does not create when approval is denied', async () => {
			const { ctx, calls } = makeCtx({});
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_create_tag').run({ orgId: 'org-sandbox', name: 'prod' }, ctx);

			assert.strictEqual(callsFor(calls, 'create').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});
	});

	suite('buddy_update_tag', () => {
		const inOrgRow = {
			data: { tags: [{ id: 'g1', name: 'old', color: '#111111', description: 'd', orgId: 'org-sandbox' }] },
		};

		test('preserves current fields not being changed', async () => {
			const { ctx, calls } = makeCtx({
				byId: inOrgRow,
				update: { data: { updateTag: { id: 'g1', name: 'old' } } },
			});
			setMcpMutationApprover(async () => true);

			await cap('buddy_update_tag').run({ orgId: 'org-sandbox', tagId: 'g1', color: '#222222' }, ctx);

			assert.deepStrictEqual(callsFor(calls, 'update')[0].variables, {
				tag: { id: 'g1', orgId: 'org-sandbox', name: 'old', color: '#222222', description: 'd' },
			});
		});

		test('renames when a new name is supplied', async () => {
			const { ctx, calls } = makeCtx({
				byId: inOrgRow,
				update: { data: { updateTag: { id: 'g1', name: 'new' } } },
			});
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_update_tag').run({ orgId: 'org-sandbox', tagId: 'g1', name: 'new' }, ctx);

			const tag = (callsFor(calls, 'update')[0].variables as { tag: Record<string, unknown> }).tag;
			assert.strictEqual(tag.name, 'new');
			assert.strictEqual(JSON.parse(output).status, 'updated');
		});

		test('refuses to update a tag in another org', async () => {
			const { ctx, calls } = makeCtx({ byId: { data: { tags: [] } } });
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_update_tag').run({ orgId: 'org-sandbox', tagId: 'g1', name: 'x' }, ctx),
				/Tag g1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'update').length, 0);
		});

		test('does not update when approval is denied', async () => {
			const { ctx, calls } = makeCtx({ byId: inOrgRow });
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_update_tag').run({ orgId: 'org-sandbox', tagId: 'g1', name: 'x' }, ctx);

			assert.strictEqual(callsFor(calls, 'update').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});
	});

	suite('buddy_delete_tag', () => {
		const inOrgRow = { data: { tags: [{ id: 'g1', name: 'old', orgId: 'org-sandbox' }] } };

		test('deletes when in-org and approved', async () => {
			const { ctx, calls } = makeCtx({ byId: inOrgRow, delete: { data: { deleteTag: 'g1' } } });
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_delete_tag').run({ orgId: 'org-sandbox', tagId: 'g1' }, ctx);

			assert.deepStrictEqual(callsFor(calls, 'delete')[0].variables, { id: 'g1' });
			assert.strictEqual(JSON.parse(output).status, 'deleted');
		});

		test('refuses to delete a tag in another org', async () => {
			const { ctx, calls } = makeCtx({ byId: { data: { tags: [] } } });
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_delete_tag').run({ orgId: 'org-sandbox', tagId: 'g1' }, ctx),
				/Tag g1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'delete').length, 0);
		});

		test('does not delete when approval is denied', async () => {
			const { ctx, calls } = makeCtx({ byId: inOrgRow });
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_delete_tag').run({ orgId: 'org-sandbox', tagId: 'g1' }, ctx);

			assert.strictEqual(callsFor(calls, 'delete').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});
	});

	suite('error and empty-result branches', () => {
		const inOrgRow = {
			data: { tags: [{ id: 'g1', name: 'old', color: '#111111', description: 'd', orgId: 'org-sandbox' }] },
		};

		test('create surfaces GraphQL errors', async () => {
			const { ctx } = makeCtx({ create: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_tag').run({ orgId: 'org-sandbox', name: 'x' }, ctx),
				/GraphQL error/,
			);
		});

		test('create throws when no tag is returned', async () => {
			const { ctx } = makeCtx({ create: { data: { createTag: {} } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_tag').run({ orgId: 'org-sandbox', name: 'x' }, ctx),
				/returned no tag/,
			);
		});

		test('update surfaces a pre-flight GraphQL error', async () => {
			const { ctx } = makeCtx({ byId: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_update_tag').run({ orgId: 'org-sandbox', tagId: 'g1', name: 'x' }, ctx),
				/GraphQL error/,
			);
		});

		test('update throws when no tag is returned', async () => {
			const { ctx } = makeCtx({ byId: inOrgRow, update: { data: { updateTag: {} } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_update_tag').run({ orgId: 'org-sandbox', tagId: 'g1', name: 'x' }, ctx),
				/returned no tag/,
			);
		});

		test('delete throws when no id is returned', async () => {
			const { ctx } = makeCtx({ byId: inOrgRow, delete: { data: { deleteTag: null } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_delete_tag').run({ orgId: 'org-sandbox', tagId: 'g1' }, ctx),
				/returned no id/,
			);
		});
	});
});
