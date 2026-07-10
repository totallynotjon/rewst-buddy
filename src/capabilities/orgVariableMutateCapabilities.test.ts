import {
	_resetMcpMutationApproverForTesting,
	setMcpMutationApprover,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import type { Session } from '@sessions';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetApprovedMutationScopes, approveMutationScope } from '../ui/chat/tools/graphqlTool';
import { ORG_VARIABLE_MUTATE_CAPABILITIES } from './orgVariableMutateCapabilities';

const { suite, test, setup, teardown } = Mocha;

function cap(name: string): Capability {
	const capability = ORG_VARIABLE_MUTATE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

interface GraphqlResult {
	data?: unknown;
	errors?: unknown;
}
type OpResponses = Partial<Record<'byId' | 'create' | 'update' | 'delete', GraphqlResult>>;

function routeOp(query: string): 'byId' | 'create' | 'update' | 'delete' | 'unknown' {
	if (query.includes('OrgVariableById')) return 'byId';
	if (query.includes('CreateOrgVariable')) return 'create';
	if (query.includes('UpdateOrgVariables')) return 'update';
	if (query.includes('DeleteOrgVariable')) return 'delete';
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

suite('Unit: orgVariableMutateCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	suite('buddy_create_org_variable', () => {
		test('is a write capability gated by approval, mcp-only', () => {
			const c = cap('buddy_create_org_variable');
			assert.strictEqual(c.access, 'write');
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('creates with defaults (general, non-cascade) when approved', async () => {
			const { ctx, calls } = makeCtx({ create: { data: { createOrgVariable: { id: 'v1', name: 'API_KEY' } } } });
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_create_org_variable').run(
				{ orgId: 'org-sandbox', name: 'API_KEY', value: 'abc' },
				ctx,
			);

			const created = callsFor(calls, 'create');
			assert.strictEqual(created.length, 1);
			assert.deepStrictEqual(created[0].variables, {
				orgVariable: {
					orgId: 'org-sandbox',
					name: 'API_KEY',
					value: 'abc',
					category: 'general',
					cascade: false,
				},
			});
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.status, 'created');
			assert.strictEqual(parsed.id, 'v1');
		});

		test('forwards secret category and cascade flag', async () => {
			const { ctx, calls } = makeCtx({ create: { data: { createOrgVariable: { id: 'v2', name: 'TOKEN' } } } });
			setMcpMutationApprover(async () => true);

			await cap('buddy_create_org_variable').run(
				{ orgId: 'org-sandbox', name: 'TOKEN', value: 's3cret', category: 'secret', cascade: true },
				ctx,
			);

			const v = callsFor(calls, 'create')[0].variables as { orgVariable: Record<string, unknown> };
			assert.strictEqual(v.orgVariable.category, 'secret');
			assert.strictEqual(v.orgVariable.cascade, true);
		});

		test('allows an empty value but rejects a missing one', async () => {
			const { ctx } = makeCtx({ create: { data: { createOrgVariable: { id: 'v3', name: 'EMPTY' } } } });
			setMcpMutationApprover(async () => true);

			await cap('buddy_create_org_variable').run({ orgId: 'org-sandbox', name: 'EMPTY', value: '' }, ctx);

			await assert.rejects(
				() => cap('buddy_create_org_variable').run({ orgId: 'org-sandbox', name: 'NOVAL' }, ctx),
				/Missing required string argument "value"/,
			);
		});

		test('rejects an unknown or reserved category before approval', async () => {
			const { ctx, calls } = makeCtx({});
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() =>
					cap('buddy_create_org_variable').run(
						{ orgId: 'org-sandbox', name: 'X', value: 'y', category: 'system' },
						ctx,
					),
				/"category" must be one of/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'create').length, 0);
		});

		test('does not create when approval is denied', async () => {
			const { ctx, calls } = makeCtx({});
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_create_org_variable').run(
				{ orgId: 'org-sandbox', name: 'API_KEY', value: 'abc' },
				ctx,
			);

			assert.strictEqual(callsFor(calls, 'create').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});
	});

	suite('buddy_update_org_variable', () => {
		const inOrgRow = {
			data: {
				orgVariables: [
					{ id: 'v1', name: 'API_KEY', category: 'general', cascade: false, orgId: 'org-sandbox' },
				],
			},
		};

		test('preserves name and updates value when in-org and approved', async () => {
			const { ctx, calls } = makeCtx({
				byId: inOrgRow,
				update: { data: { updateOrgVariables: [{ id: 'v1', name: 'API_KEY' }] } },
			});
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_update_org_variable').run(
				{ orgId: 'org-sandbox', variableId: 'v1', value: 'new-value' },
				ctx,
			);

			const upd = callsFor(calls, 'update');
			assert.strictEqual(upd.length, 1);
			assert.deepStrictEqual(upd[0].variables, {
				orgVariables: [
					{
						id: 'v1',
						orgId: 'org-sandbox',
						name: 'API_KEY',
						value: 'new-value',
						category: 'general',
						cascade: false,
					},
				],
			});
			assert.strictEqual(JSON.parse(output).status, 'updated');
		});

		test('applies category and cascade overrides', async () => {
			const { ctx, calls } = makeCtx({
				byId: inOrgRow,
				update: { data: { updateOrgVariables: [{ id: 'v1', name: 'API_KEY' }] } },
			});
			setMcpMutationApprover(async () => true);

			await cap('buddy_update_org_variable').run(
				{ orgId: 'org-sandbox', variableId: 'v1', value: 'x', category: 'secret', cascade: true },
				ctx,
			);

			const payload = (callsFor(calls, 'update')[0].variables as { orgVariables: Record<string, unknown>[] })
				.orgVariables[0];
			assert.strictEqual(payload.category, 'secret');
			assert.strictEqual(payload.cascade, true);
		});

		test('refuses to update a variable in another org', async () => {
			const { ctx, calls } = makeCtx({ byId: { data: { orgVariables: [] } } });
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_update_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1', value: 'x' }, ctx),
				/Org variable v1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'update').length, 0);
		});

		test('does not update when approval is denied', async () => {
			const { ctx, calls } = makeCtx({ byId: inOrgRow });
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_update_org_variable').run(
				{ orgId: 'org-sandbox', variableId: 'v1', value: 'x' },
				ctx,
			);

			assert.strictEqual(callsFor(calls, 'update').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});

		test('requires a value', async () => {
			const { ctx } = makeCtx({ byId: inOrgRow });
			setMcpMutationApprover(async () => true);

			await assert.rejects(
				() => cap('buddy_update_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1' }, ctx),
				/Missing required string argument "value"/,
			);
		});
	});

	suite('buddy_delete_org_variable', () => {
		const inOrgRow = {
			data: {
				orgVariables: [
					{ id: 'v1', name: 'API_KEY', category: 'general', cascade: false, orgId: 'org-sandbox' },
				],
			},
		};

		test('deletes when in-org and approved', async () => {
			const { ctx, calls } = makeCtx({ byId: inOrgRow, delete: { data: { deleteOrgVariable: 'v1' } } });
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_delete_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1' }, ctx);

			assert.strictEqual(callsFor(calls, 'delete').length, 1);
			assert.deepStrictEqual(callsFor(calls, 'delete')[0].variables, { id: 'v1' });
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.status, 'deleted');
			assert.strictEqual(parsed.id, 'v1');
		});

		test('refuses to delete a variable in another org', async () => {
			const { ctx, calls } = makeCtx({ byId: { data: { orgVariables: [] } } });
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_delete_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1' }, ctx),
				/Org variable v1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'delete').length, 0);
		});

		test('does not delete when approval is denied', async () => {
			const { ctx, calls } = makeCtx({ byId: inOrgRow });
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_delete_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1' }, ctx);

			assert.strictEqual(callsFor(calls, 'delete').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});

		test('still prompts even when a prior non-delete mutation on the same variable was approved (#177)', async () => {
			const { ctx, calls } = makeCtx({ byId: inOrgRow, delete: { data: { deleteOrgVariable: 'v1' } } });
			// Simulate any earlier non-delete mutation (e.g. update) on this same
			// variable having been approved this session — the scope key is only
			// [orgId, variableId].
			approveMutationScope({ scopeId: 'v1', scopeName: 'API_KEY', orgId: 'org-sandbox', orgName: 'Sandbox' });

			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await cap('buddy_delete_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1' }, ctx);

			assert.ok(approverCalled, 'delete must still prompt even though the shared scope was already approved');
			assert.strictEqual(callsFor(calls, 'delete').length, 1);
		});
	});

	suite('error and empty-result branches', () => {
		const inOrgRow = {
			data: {
				orgVariables: [
					{ id: 'v1', name: 'API_KEY', category: 'general', cascade: false, orgId: 'org-sandbox' },
				],
			},
		};

		test('create surfaces GraphQL errors', async () => {
			const { ctx, calls } = makeCtx({ create: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_org_variable').run({ orgId: 'org-sandbox', name: 'X', value: 'y' }, ctx),
				/GraphQL error/,
			);
			assert.strictEqual(callsFor(calls, 'create').length, 1);
		});

		test('create throws when no variable is returned', async () => {
			const { ctx } = makeCtx({ create: { data: { createOrgVariable: {} } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_org_variable').run({ orgId: 'org-sandbox', name: 'X', value: 'y' }, ctx),
				/returned no variable/,
			);
		});

		test('update surfaces a pre-flight GraphQL error', async () => {
			const { ctx } = makeCtx({ byId: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_update_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1', value: 'y' }, ctx),
				/GraphQL error/,
			);
		});

		test('update throws when no variable is returned', async () => {
			const { ctx } = makeCtx({ byId: inOrgRow, update: { data: { updateOrgVariables: [] } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_update_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1', value: 'y' }, ctx),
				/returned no variable/,
			);
		});

		test('delete throws when no id is returned', async () => {
			const { ctx } = makeCtx({ byId: inOrgRow, delete: { data: { deleteOrgVariable: null } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_delete_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1' }, ctx),
				/returned no id/,
			);
		});

		test('surfaces GraphQL errors from the org-variable lookup instead of treating them as not-found', async () => {
			// The byId lookup returns an errors-carrying response (not a thrown error).
			// A wrong migration that returns undefined from fetch() on errors would
			// convert this into the misleading "not in org" message, masking an auth/outage.
			// This test forces rawGraphqlOrThrow (or equivalent) to be used inside fetch.
			const { ctx, calls } = makeCtx({ byId: { data: undefined, errors: [{ message: 'denied' }] } });
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_update_org_variable').run({ orgId: 'org-sandbox', variableId: 'v1', value: 'x' }, ctx),
				(err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					assert.ok(/GraphQL error/i.test(msg), `expected GraphQL error, got: ${msg}`);
					assert.ok(msg.includes('denied'), `expected 'denied' in message, got: ${msg}`);
					return true;
				},
			);
			assert.strictEqual(approverCalled, false, 'approver must not be called before org check');
			assert.strictEqual(callsFor(calls, 'update').length, 0);
		});
	});
});
