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
import { TRIGGER_MUTATE_CAPABILITIES } from './triggerMutateCapabilities';

const { suite, test, setup, teardown } = Mocha;

function cap(name: string): Capability {
	const capability = TRIGGER_MUTATE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

interface GraphqlResult {
	data?: unknown;
	errors?: unknown;
}
type Op = 'byId' | 'update';
type OpResponses = Partial<Record<Op, GraphqlResult>>;

function routeOp(query: string): Op | 'unknown' {
	if (query.includes('TriggerById')) return 'byId';
	if (query.includes('SetTriggerEnabled')) return 'update';
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

suite('Unit: triggerMutateCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	suite('buddy_set_trigger_enabled', () => {
		const inOrgDisabled = {
			data: { triggers: [{ id: 't1', name: 'Nightly', enabled: false, orgId: 'org-sandbox' }] },
		};

		test('is a write capability gated by approval, mcp-only', () => {
			const c = cap('buddy_set_trigger_enabled');
			assert.strictEqual(c.access, 'write');
			assert.strictEqual(c.mcp, true);
			assert.strictEqual(c.chat, false);
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('enables a trigger when in-org and approved', async () => {
			const { ctx, calls } = makeCtx({
				byId: inOrgDisabled,
				update: { data: { updateTrigger: { id: 't1', name: 'Nightly', enabled: true } } },
			});
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_set_trigger_enabled').run(
				{ orgId: 'org-sandbox', triggerId: 't1', enabled: true },
				ctx,
			);

			assert.deepStrictEqual(callsFor(calls, 'update')[0].variables, { trigger: { id: 't1', enabled: true } });
			assert.strictEqual(JSON.parse(output).status, 'enabled');
		});

		test('disables a trigger and reports disabled', async () => {
			const { ctx, calls } = makeCtx({
				byId: { data: { triggers: [{ id: 't1', name: 'Nightly', enabled: true, orgId: 'org-sandbox' }] } },
				update: { data: { updateTrigger: { id: 't1', name: 'Nightly', enabled: false } } },
			});
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_set_trigger_enabled').run(
				{ orgId: 'org-sandbox', triggerId: 't1', enabled: false },
				ctx,
			);

			assert.strictEqual(
				(callsFor(calls, 'update')[0].variables as { trigger: { enabled: boolean } }).trigger.enabled,
				false,
			);
			assert.strictEqual(JSON.parse(output).status, 'disabled');
		});

		test('refuses to toggle a trigger in another org', async () => {
			const { ctx, calls } = makeCtx({ byId: { data: { triggers: [] } } });
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() =>
					cap('buddy_set_trigger_enabled').run({ orgId: 'org-sandbox', triggerId: 't1', enabled: true }, ctx),
				/Trigger t1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'update').length, 0);
		});

		test('requires a boolean enabled before fetching or approving', async () => {
			const { ctx, calls } = makeCtx({});
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_set_trigger_enabled').run({ orgId: 'org-sandbox', triggerId: 't1' }, ctx),
				/Missing required boolean argument "enabled"/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'byId').length, 0);
		});

		test('does not mutate when approval is denied', async () => {
			const { ctx, calls } = makeCtx({ byId: inOrgDisabled });
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_set_trigger_enabled').run(
				{ orgId: 'org-sandbox', triggerId: 't1', enabled: true },
				ctx,
			);

			assert.strictEqual(callsFor(calls, 'update').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});
	});

	suite('error and empty-result branches', () => {
		const inOrgDisabled = {
			data: { triggers: [{ id: 't1', name: 'Nightly', enabled: false, orgId: 'org-sandbox' }] },
		};

		test('surfaces a pre-flight GraphQL error', async () => {
			const { ctx } = makeCtx({ byId: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_enabled').run({ orgId: 'org-sandbox', triggerId: 't1', enabled: true }, ctx),
				/GraphQL error/,
			);
		});

		test('surfaces a mutation GraphQL error', async () => {
			const { ctx } = makeCtx({ byId: inOrgDisabled, update: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_enabled').run({ orgId: 'org-sandbox', triggerId: 't1', enabled: true }, ctx),
				/GraphQL error/,
			);
		});

		test('throws when no trigger is returned', async () => {
			const { ctx } = makeCtx({ byId: inOrgDisabled, update: { data: { updateTrigger: {} } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_enabled').run({ orgId: 'org-sandbox', triggerId: 't1', enabled: true }, ctx),
				/returned no trigger/,
			);
		});
	});
});
