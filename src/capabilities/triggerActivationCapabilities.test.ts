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
import { TRIGGER_ACTIVATION_CAPABILITIES } from './triggerActivationCapabilities';

const { suite, test, setup, teardown } = Mocha;

function cap(name: string): Capability {
	const capability = TRIGGER_ACTIVATION_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

interface GraphqlResult {
	data?: unknown;
	errors?: unknown;
}
// 'read' is the trigger-state query (used by both the verification read and the
// helper's before/after reads); 'update' is the updateTrigger mutation.
type Op = 'read' | 'update';
type OpResponses = Partial<Record<Op, GraphqlResult | GraphqlResult[]>>;

function routeOp(query: string): Op | 'unknown' {
	if (query.includes('TriggerStateById')) return 'read';
	if (query.includes('UpdateTrigger')) return 'update';
	return 'unknown';
}

/**
 * Mock context. `read` may be a single response or an array consumed in order,
 * so a test can return a different post-write state than the pre-write read.
 */
function makeCtx(responses: OpResponses, orgId = 'org-sandbox', orgName = 'Sandbox') {
	const calls: { op: string; variables: Record<string, unknown> | undefined }[] = [];
	const readQueue = Array.isArray(responses.read) ? [...responses.read] : undefined;
	const session = {
		profile: { org: { id: orgId, name: orgName }, allManagedOrgs: [{ id: orgId, name: orgName }] },
		rawGraphql: async (query: string, variables?: Record<string, unknown>) => {
			const op = routeOp(query);
			calls.push({ op, variables });
			if (op === 'read' && readQueue) {
				const next = readQueue.shift();
				if (!next) throw new Error('read queue exhausted');
				return next;
			}
			const r = responses[op as keyof OpResponses] as GraphqlResult | undefined;
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

function triggerRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 't1',
		name: 'Nightly',
		enabled: true,
		orgId: 'org-sandbox',
		workflowId: 'wf1',
		formId: null,
		description: 'desc',
		autoActivateManagedOrgs: false,
		criteria: null,
		parameters: null,
		state: null,
		cloneOverrides: { activatedForOrgIds: ['orgClone'] },
		tags: [{ id: 'tagX', name: 'X' }],
		activatedForOrgs: [{ id: 'orgA', name: 'Org A' }],
		...overrides,
	};
}

function readResult(overrides: Record<string, unknown> = {}): GraphqlResult {
	return { data: { triggers: [triggerRow(overrides)] } };
}

const UPDATE_OK: GraphqlResult = { data: { updateTrigger: { id: 't1', name: 'Nightly', orgId: 'org-sandbox' } } };

function sentTrigger(calls: { op: string; variables: Record<string, unknown> | undefined }[]) {
	return callsFor(calls, 'update')[0].variables as {
		trigger: Record<string, unknown>;
		createPatch: boolean;
	};
}

suite('Unit: triggerActivationCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	suite('buddy_set_trigger_activation', () => {
		test('is a write capability, org-scoped', () => {
			const c = cap('buddy_set_trigger_activation');
			assert.strictEqual(c.access, 'write');
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('overwrites the explicit activation with exactly the orgIds (no merge against the resolved set)', async () => {
			// before.activatedForOrgs is [orgA]; a full-replace to [orgZ] must send
			// exactly [orgZ] and never merge orgA back in (orgA may be a tag/auto
			// activation, not an explicit one — echoing it would silently pin it).
			const { ctx, calls } = makeCtx({
				read: [readResult(), readResult(), readResult({ activatedForOrgs: [{ id: 'orgZ' }] })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgZ'] },
					ctx,
				),
			);

			const sent = sentTrigger(calls);
			assert.deepStrictEqual(sent.trigger.activatedForOrgIds, ['orgZ']);
			assert.strictEqual(sent.createPatch, true);
			assert.strictEqual(output.status, 'updated');
			assert.deepStrictEqual(output.resolvedActivatedForOrgs.before, ['orgA']);
			assert.deepStrictEqual(output.resolvedActivatedForOrgs.after, ['orgZ']);
		});

		test('uses a fresh post-approval read for the diff baseline, not the pre-approval preview', async () => {
			// read#0 is the pre-approval preview (verifies org, names the trigger);
			// read#1 is the fresh post-approval "before" (the diff/output baseline);
			// read#2 is the "after". If the handler reused the preview as the
			// baseline (skipping the second read), the baseline would show orgA/false
			// instead of the fresh orgFresh/true.
			const { ctx, calls } = makeCtx({
				read: [
					readResult({ activatedForOrgs: [{ id: 'orgA' }], autoActivateManagedOrgs: false }),
					readResult({ activatedForOrgs: [{ id: 'orgFresh' }], autoActivateManagedOrgs: true }),
					readResult({ activatedForOrgs: [{ id: 'orgB' }], autoActivateManagedOrgs: false }),
				],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'] },
					ctx,
				),
			);

			assert.strictEqual(callsFor(calls, 'read').length, 3, 'preview + fresh before + after');
			assert.deepStrictEqual(output.resolvedActivatedForOrgs.before, ['orgFresh'], 'baseline is the fresh read');
			assert.strictEqual(output.autoActivateManagedOrgs.before, true, 'autoActivate baseline is the fresh read');
			assert.deepStrictEqual(output.changed.activatedForOrgIds, { before: ['orgFresh'], after: ['orgB'] });
		});

		test('dedupes the requested org set', async () => {
			const { ctx, calls } = makeCtx({
				read: [readResult(), readResult(), readResult({ activatedForOrgs: [{ id: 'orgZ' }] })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);
			await cap('buddy_set_trigger_activation').run(
				{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgZ', 'orgZ'] },
				ctx,
			);
			assert.deepStrictEqual(sentTrigger(calls).trigger.activatedForOrgIds, ['orgZ']);
		});

		test('an empty org list deactivates all orgs', async () => {
			const { ctx, calls } = makeCtx({
				read: [readResult(), readResult(), readResult({ activatedForOrgs: [] })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', orgIds: [] },
					ctx,
				),
			);
			assert.deepStrictEqual(sentTrigger(calls).trigger.activatedForOrgIds, []);
			assert.deepStrictEqual(output.resolvedActivatedForOrgs.after, []);
		});

		test('never sends cloneOverrides or touches tags', async () => {
			const { ctx, calls } = makeCtx({
				read: [readResult(), readResult(), readResult({ activatedForOrgs: [{ id: 'orgB' }] })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);
			await cap('buddy_set_trigger_activation').run(
				{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'] },
				ctx,
			);
			const sent = sentTrigger(calls);
			assert.ok(!('cloneOverrides' in sent.trigger), 'cloneOverrides is not part of the update input');
			assert.ok(!('activatedForTagIds' in sent.trigger), 'the activation tool does not touch tags');
		});

		test('sets autoActivateManagedOrgs alone without an org edit', async () => {
			const { ctx, calls } = makeCtx({
				read: [readResult(), readResult(), readResult({ autoActivateManagedOrgs: true })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', autoActivateManagedOrgs: true },
					ctx,
				),
			);
			const sent = sentTrigger(calls);
			assert.strictEqual(sent.trigger.autoActivateManagedOrgs, true);
			assert.ok(!('activatedForOrgIds' in sent.trigger), 'no org edit means no activatedForOrgIds');
			assert.strictEqual(sent.createPatch, true);
			assert.deepStrictEqual(output.autoActivateManagedOrgs, { before: false, after: true });
		});

		test('accepts autoActivateManagedOrgs=false as a real change', async () => {
			const { ctx, calls } = makeCtx({
				read: [
					readResult({ autoActivateManagedOrgs: true }),
					readResult({ autoActivateManagedOrgs: true }),
					readResult({ autoActivateManagedOrgs: false }),
				],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);
			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', autoActivateManagedOrgs: false },
					ctx,
				),
			);
			assert.strictEqual(sentTrigger(calls).trigger.autoActivateManagedOrgs, false);
			assert.deepStrictEqual(output.autoActivateManagedOrgs, { before: true, after: false });
		});

		test('sets an org edit and autoActivateManagedOrgs together', async () => {
			const { ctx, calls } = makeCtx({
				read: [
					readResult(),
					readResult(),
					readResult({ activatedForOrgs: [{ id: 'orgB' }], autoActivateManagedOrgs: true }),
				],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);
			await cap('buddy_set_trigger_activation').run(
				{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'], autoActivateManagedOrgs: true },
				ctx,
			);
			const sent = sentTrigger(calls);
			assert.deepStrictEqual(sent.trigger.activatedForOrgIds, ['orgB']);
			assert.strictEqual(sent.trigger.autoActivateManagedOrgs, true);
		});

		test('reports a before/after diff of the changed activation orgs', async () => {
			const { ctx } = makeCtx({
				read: [readResult(), readResult(), readResult({ activatedForOrgs: [{ id: 'orgA' }, { id: 'orgB' }] })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);
			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgA', 'orgB'] },
					ctx,
				),
			);
			assert.deepStrictEqual(output.changed.activatedForOrgIds, { before: ['orgA'], after: ['orgA', 'orgB'] });
		});

		test('surfaces a non-activation side effect in the diff', async () => {
			// The post-write read reports a tag shift the edit did not request; the
			// diff must surface it alongside the activation change (the #181 concern).
			const { ctx } = makeCtx({
				read: [
					readResult(),
					readResult(),
					readResult({ activatedForOrgs: [{ id: 'orgB' }], tags: [{ id: 'tagY' }] }),
				],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);
			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'] },
					ctx,
				),
			);
			assert.deepStrictEqual(output.changed.activatedForOrgIds, { before: ['orgA'], after: ['orgB'] });
			assert.deepStrictEqual(output.changed.tagIds, { before: ['tagX'], after: ['tagY'] });
		});

		test('refuses a trigger in another org before approving', async () => {
			const { ctx, calls } = makeCtx({ read: { data: { triggers: [] } } });
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_activation').run(
						{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'] },
						ctx,
					),
				/Trigger t1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'update').length, 0);
		});

		test('a prior approval is never reused: a later edit prompts anew', async () => {
			const { ctx, calls } = makeCtx({ read: readResult(), update: UPDATE_OK });
			setMcpMutationApprover(async () => true);
			await cap('buddy_set_trigger_activation').run(
				{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'] },
				ctx,
			);

			setMcpMutationApprover(async () => false);
			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', orgIds: [] },
					ctx,
				),
			);
			assert.strictEqual(output.status, 'approval_required');
			assert.strictEqual(callsFor(calls, 'update').length, 1, 'the denied clear did not mutate');
		});

		test('does not mutate when approval is denied', async () => {
			const { ctx, calls } = makeCtx({ read: readResult(), update: UPDATE_OK });
			setMcpMutationApprover(async () => false);
			const output = JSON.parse(
				await cap('buddy_set_trigger_activation').run(
					{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'] },
					ctx,
				),
			);
			assert.strictEqual(callsFor(calls, 'update').length, 0);
			assert.strictEqual(output.status, 'approval_required');
		});

		test('rejects an org list containing an empty string', async () => {
			const { ctx } = makeCtx({ read: readResult() });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_activation').run(
						{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['   '] },
						ctx,
					),
				/Missing required string argument "orgIds"/,
			);
		});

		test('rejects a call that changes nothing', async () => {
			const { ctx, calls } = makeCtx({ read: readResult() });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_set_trigger_activation').run({ orgId: 'org-sandbox', triggerId: 't1' }, ctx),
				/Provide an org activation set/,
			);
			assert.strictEqual(callsFor(calls, 'read').length, 0);
		});

		test('rejects a non-boolean autoActivateManagedOrgs', async () => {
			const { ctx } = makeCtx({ read: readResult() });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_activation').run(
						{ orgId: 'org-sandbox', triggerId: 't1', autoActivateManagedOrgs: 'yes' },
						ctx,
					),
				/"autoActivateManagedOrgs" must be a boolean/,
			);
		});

		test('propagates a mutation GraphQL error', async () => {
			const { ctx } = makeCtx({ read: readResult(), update: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_activation').run(
						{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'] },
						ctx,
					),
				/GraphQL error/,
			);
		});

		test('throws when the mutation returns no trigger', async () => {
			const { ctx } = makeCtx({ read: readResult(), update: { data: { updateTrigger: {} } } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_activation').run(
						{ orgId: 'org-sandbox', triggerId: 't1', orgIds: ['orgB'] },
						ctx,
					),
				/returned no trigger/,
			);
		});
	});
});
