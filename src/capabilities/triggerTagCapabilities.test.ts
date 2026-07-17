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
import { TRIGGER_TAG_CAPABILITIES } from './triggerTagCapabilities';

const { suite, test, setup, teardown } = Mocha;

function cap(name: string): Capability {
	const capability = TRIGGER_TAG_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

interface GraphqlResult {
	data?: unknown;
	errors?: unknown;
}
// 'read' is the trigger-state query (used by both the read tool and the helper's
// before/after reads); 'update' is the updateTrigger mutation.
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
		cloneOverrides: { activatedForOrgIds: ['orgA'] },
		tags: [{ id: 'tagX', name: 'X' }],
		activatedForOrgs: [{ id: 'orgA', name: 'Org A' }],
		...overrides,
	};
}

function readResult(overrides: Record<string, unknown> = {}): GraphqlResult {
	return { data: { triggers: [triggerRow(overrides)] } };
}

const UPDATE_OK: GraphqlResult = { data: { updateTrigger: { id: 't1', name: 'Nightly', orgId: 'org-sandbox' } } };

suite('Unit: triggerTagCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	suite('buddy_get_trigger', () => {
		test('is a read capability', () => {
			const c = cap('buddy_get_trigger');
			assert.strictEqual(c.access, 'read');
		});

		test('surfaces activation-related fields and tagIds', async () => {
			const { ctx } = makeCtx({ read: readResult() });
			const output = JSON.parse(
				await cap('buddy_get_trigger').run({ orgId: 'org-sandbox', triggerId: 't1' }, ctx),
			);
			assert.strictEqual(output.id, 't1');
			assert.deepStrictEqual(output.tagIds, ['tagX']);
			assert.deepStrictEqual(output.activatedForOrgs, [{ id: 'orgA', name: 'Org A' }]);
			assert.deepStrictEqual(output.cloneOverrides, { activatedForOrgIds: ['orgA'] });
			assert.strictEqual(output.autoActivateManagedOrgs, false);
		});

		test('is honest that top-level activatedForOrgIds is not readable', async () => {
			const { ctx } = makeCtx({ read: readResult() });
			const output = JSON.parse(
				await cap('buddy_get_trigger').run({ orgId: 'org-sandbox', triggerId: 't1' }, ctx),
			);
			assert.ok(/activatedForOrgIds/.test(output.notes));
			assert.ok(/not independently readable/i.test(output.notes));
			assert.strictEqual(output.activatedForOrgIds, undefined, 'top-level activatedForOrgIds is not surfaced');
		});

		test('rejects a trigger in another org', async () => {
			const { ctx } = makeCtx({ read: { data: { triggers: [] } } });
			await assert.rejects(
				() => cap('buddy_get_trigger').run({ orgId: 'org-sandbox', triggerId: 't1' }, ctx),
				/Trigger t1 is not in org org-sandbox/,
			);
		});

		test('rejects a returned row whose orgId mismatches the requested org', async () => {
			const { ctx } = makeCtx({ read: readResult({ orgId: 'org-other' }) });
			await assert.rejects(
				() => cap('buddy_get_trigger').run({ orgId: 'org-sandbox', triggerId: 't1' }, ctx),
				/Trigger t1 is not in org org-sandbox/,
			);
		});

		test('requires a triggerId', async () => {
			const { ctx } = makeCtx({});
			await assert.rejects(
				() => cap('buddy_get_trigger').run({ orgId: 'org-sandbox' }, ctx),
				/Missing required string argument "triggerId"/,
			);
		});

		test('propagates a GraphQL error', async () => {
			const { ctx } = makeCtx({ read: { errors: [{ message: 'boom' }] } });
			await assert.rejects(
				() => cap('buddy_get_trigger').run({ orgId: 'org-sandbox', triggerId: 't1' }, ctx),
				/GraphQL error/,
			);
		});
	});

	suite('buddy_set_trigger_tags', () => {
		test('is a write capability, org-scoped', () => {
			const c = cap('buddy_set_trigger_tags');
			assert.strictEqual(c.access, 'write');
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('add merges new tags with existing ones (never drops)', async () => {
			const { ctx, calls } = makeCtx({
				read: [readResult(), readResult(), readResult({ tags: [{ id: 'tagX' }, { id: 'tagY' }] })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			const output = JSON.parse(
				await cap('buddy_set_trigger_tags').run(
					{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
					ctx,
				),
			);

			const sent = callsFor(calls, 'update')[0].variables as {
				trigger: { activatedForTagIds: string[] };
				createPatch: boolean;
			};
			assert.deepStrictEqual(sent.trigger.activatedForTagIds, ['tagX', 'tagY']);
			assert.strictEqual(sent.createPatch, true);
			assert.strictEqual(output.status, 'updated');
			assert.deepStrictEqual(output.tagIds.before, ['tagX']);
			assert.deepStrictEqual(output.tagIds.after, ['tagX', 'tagY']);
		});

		test('add merges against a fresh post-approval read (concurrent tag change preserved)', async () => {
			// The tag set changes while the approval prompt is open: the fresh
			// post-approval read returns tagX + tagConcurrent, and the merge must
			// build on that state rather than the stale pre-approval read.
			const { ctx, calls } = makeCtx({
				read: [
					readResult(),
					readResult({ tags: [{ id: 'tagX' }, { id: 'tagConcurrent' }] }),
					readResult({ tags: [{ id: 'tagX' }, { id: 'tagConcurrent' }, { id: 'tagY' }] }),
				],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			const output = JSON.parse(
				await cap('buddy_set_trigger_tags').run(
					{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
					ctx,
				),
			);

			const sent = callsFor(calls, 'update')[0].variables as { trigger: { activatedForTagIds: string[] } };
			assert.deepStrictEqual(sent.trigger.activatedForTagIds, ['tagX', 'tagConcurrent', 'tagY']);
			assert.deepStrictEqual(output.tagIds.before, ['tagX', 'tagConcurrent']);
			assert.deepStrictEqual(output.tagIds.after, ['tagX', 'tagConcurrent', 'tagY']);
		});

		test('add is idempotent for a tag already present', async () => {
			const { ctx, calls } = makeCtx({ read: [readResult(), readResult(), readResult()], update: UPDATE_OK });
			setMcpMutationApprover(async () => true);
			await cap('buddy_set_trigger_tags').run(
				{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagX'] },
				ctx,
			);
			const sent = callsFor(calls, 'update')[0].variables as { trigger: { activatedForTagIds: string[] } };
			assert.deepStrictEqual(sent.trigger.activatedForTagIds, ['tagX']);
		});

		test('remove sends the remaining tags', async () => {
			const { ctx, calls } = makeCtx({
				read: [
					readResult({ tags: [{ id: 'tagX' }, { id: 'tagY' }] }),
					readResult({ tags: [{ id: 'tagX' }, { id: 'tagY' }] }),
					readResult({ tags: [{ id: 'tagX' }] }),
				],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			await cap('buddy_set_trigger_tags').run(
				{ orgId: 'org-sandbox', triggerId: 't1', operation: 'remove', tagIds: ['tagY'] },
				ctx,
			);

			const sent = callsFor(calls, 'update')[0].variables as {
				trigger: { activatedForTagIds: string[] };
				createPatch: boolean;
			};
			assert.deepStrictEqual(sent.trigger.activatedForTagIds, ['tagX']);
			assert.strictEqual(sent.createPatch, true);
		});

		test('replace sets the tag set exactly', async () => {
			const { ctx, calls } = makeCtx({
				read: [readResult(), readResult(), readResult({ tags: [{ id: 'tagZ' }] })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			await cap('buddy_set_trigger_tags').run(
				{ orgId: 'org-sandbox', triggerId: 't1', operation: 'replace', tagIds: ['tagZ', 'tagZ'] },
				ctx,
			);

			const sent = callsFor(calls, 'update')[0].variables as { trigger: { activatedForTagIds: string[] } };
			assert.deepStrictEqual(sent.trigger.activatedForTagIds, ['tagZ']);
		});

		test('reports a before/after diff of the changed tags', async () => {
			const { ctx } = makeCtx({
				read: [readResult(), readResult(), readResult({ tags: [{ id: 'tagX' }, { id: 'tagY' }] })],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			const output = JSON.parse(
				await cap('buddy_set_trigger_tags').run(
					{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
					ctx,
				),
			);
			assert.deepStrictEqual(output.changed.tagIds, { before: ['tagX'], after: ['tagX', 'tagY'] });
		});

		test('surfaces a non-tag side effect in the diff', async () => {
			// The post-write read reports an activation-org shift the edit did not
			// request; the diff must surface it alongside the tag change.
			const { ctx } = makeCtx({
				read: [
					readResult(),
					readResult(),
					readResult({
						tags: [{ id: 'tagX' }, { id: 'tagY' }],
						activatedForOrgs: [{ id: 'orgB', name: 'Org B' }],
					}),
				],
				update: UPDATE_OK,
			});
			setMcpMutationApprover(async () => true);

			const output = JSON.parse(
				await cap('buddy_set_trigger_tags').run(
					{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
					ctx,
				),
			);
			assert.deepStrictEqual(output.changed.tagIds, { before: ['tagX'], after: ['tagX', 'tagY'] });
			assert.deepStrictEqual(output.changed.activatedForOrgIds, { before: ['orgA'], after: ['orgB'] });
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
					cap('buddy_set_trigger_tags').run(
						{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
						ctx,
					),
				/Trigger t1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(callsFor(calls, 'update').length, 0);
		});

		test('a prior approval is never reused: a later edit prompts anew', async () => {
			// replace can clear the whole tag set, so an approval granted for a
			// benign add on the same trigger must not let it through silently.
			const { ctx, calls } = makeCtx({ read: readResult(), update: UPDATE_OK });
			setMcpMutationApprover(async () => true);
			await cap('buddy_set_trigger_tags').run(
				{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
				ctx,
			);

			setMcpMutationApprover(async () => false);
			const output = JSON.parse(
				await cap('buddy_set_trigger_tags').run(
					{ orgId: 'org-sandbox', triggerId: 't1', operation: 'replace', tagIds: ['tagZ'] },
					ctx,
				),
			);
			assert.strictEqual(output.status, 'approval_required');
			assert.strictEqual(callsFor(calls, 'update').length, 1, 'the denied replace did not mutate');
		});

		test('does not mutate when approval is denied', async () => {
			const { ctx, calls } = makeCtx({ read: readResult(), update: UPDATE_OK });
			setMcpMutationApprover(async () => false);
			const output = JSON.parse(
				await cap('buddy_set_trigger_tags').run(
					{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
					ctx,
				),
			);
			assert.strictEqual(callsFor(calls, 'update').length, 0);
			assert.strictEqual(output.status, 'approval_required');
		});

		test('rejects an unknown operation', async () => {
			const { ctx, calls } = makeCtx({ read: readResult() });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_tags').run(
						{ orgId: 'org-sandbox', triggerId: 't1', operation: 'toggle', tagIds: ['tagY'] },
						ctx,
					),
				/"operation" must be one of add, remove, replace/,
			);
			assert.strictEqual(callsFor(calls, 'read').length, 0);
		});

		test('rejects an empty tag list', async () => {
			const { ctx } = makeCtx({ read: readResult() });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_tags').run(
						{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: [] },
						ctx,
					),
				/Missing required non-empty string array argument "tagIds"/,
			);
		});

		test('rejects a tag list containing an empty string', async () => {
			const { ctx } = makeCtx({ read: readResult() });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_tags').run(
						{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['   '] },
						ctx,
					),
				/Missing required string argument "tagIds"/,
			);
		});

		test('propagates a mutation GraphQL error', async () => {
			const { ctx } = makeCtx({ read: readResult(), update: { errors: [{ message: 'boom' }] } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_set_trigger_tags').run(
						{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
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
					cap('buddy_set_trigger_tags').run(
						{ orgId: 'org-sandbox', triggerId: 't1', operation: 'add', tagIds: ['tagY'] },
						ctx,
					),
				/returned no trigger/,
			);
		});
	});
});
