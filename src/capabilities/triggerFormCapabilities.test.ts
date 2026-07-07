import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { TRIGGER_FORM_CAPABILITIES } from './triggerFormCapabilities';
const { suite, test, setup } = Mocha;
const { fakeCtx, cap } = createCapabilityTestHarness(TRIGGER_FORM_CAPABILITIES);
suite('Unit: triggerFormCapabilities', () => {
	setup(() => initTestEnvironment());

	// --- Zod parse tests ---
	test('missing orgId throws before GraphQL', async () => {
		const { ctx } = fakeCtx({ data: {} });
		await assert.rejects(() => cap('buddy_list_triggers').run({}, ctx), /orgId/);
	});

	test('non-number limit falls back to default (no throw)', async () => {
		const { ctx } = fakeCtx({ data: { triggers: [] } });
		await assert.doesNotReject(() => cap('buddy_list_triggers').run({ orgId: 'org-1', limit: 'bad' }, ctx));
	});

	test('fractional limit is floored', async () => {
		const { ctx, calls } = fakeCtx({ data: { triggers: [] } });
		await cap('buddy_list_triggers').run({ orgId: 'org-1', limit: 7.9 }, ctx);
		assert.strictEqual(calls[0].variables!.limit, 7);
	});

	test('over-max limit is clamped to 200', async () => {
		const { ctx, calls } = fakeCtx({ data: { triggers: [] } });
		await cap('buddy_list_triggers').run({ orgId: 'org-1', limit: 9999 }, ctx);
		assert.strictEqual(calls[0].variables!.limit, 200);
	});

	test('buddy_list_triggers derived schema has orgId required and limit optional', () => {
		const schema = cap('buddy_list_triggers').spec.inputSchema as {
			required: string[];
			properties: Record<string, unknown>;
		};
		assert.ok(schema.required.includes('orgId'));
		assert.ok('limit' in schema.properties);
		assert.strictEqual(cap('buddy_list_triggers').spec.args, JSON.stringify(schema));
	});

	test('buddy_list_forms derived schema has orgId required', () => {
		const schema = cap('buddy_list_forms').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.strictEqual(cap('buddy_list_forms').spec.args, JSON.stringify(schema));
	});

	test('buddy_list_tags derived schema has orgId required', () => {
		const schema = cap('buddy_list_tags').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.strictEqual(cap('buddy_list_tags').spec.args, JSON.stringify(schema));
	});

	test('buddy_list_org_trigger_instances derived schema has orgId required', () => {
		const schema = cap('buddy_list_org_trigger_instances').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.strictEqual(cap('buddy_list_org_trigger_instances').spec.args, JSON.stringify(schema));
	});

	test('buddy_get_trigger_error_status derived schema has orgId and triggerIds required', () => {
		const schema = cap('buddy_get_trigger_error_status').spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.ok(schema.required.includes('triggerIds'));
		assert.strictEqual(cap('buddy_get_trigger_error_status').spec.args, JSON.stringify(schema));
	});

	test('buddy_list_triggers uses triggers query and formats trigger rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				triggers: [
					{ id: 'trig-1', name: 'Alert trigger', enabled: true, triggerTypeId: 'type-1', workflowId: 'wf-1' },
				],
			},
		});

		const output = await cap('buddy_list_triggers').run({ orgId: 'org-1', limit: 25 }, ctx);

		assert.ok(calls[0].query.includes('triggers('));
		assert.ok(output.includes('Alert trigger (trig-1) → workflow wf-1'));
	});

	test('buddy_list_forms uses forms query and formats form rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				forms: [{ id: 'form-1', name: 'Client intake', updatedAt: '1710000000000' }],
			},
		});

		const output = await cap('buddy_list_forms').run({ orgId: 'org-1', limit: 25 }, ctx);

		assert.ok(calls[0].query.includes('forms('));
		assert.ok(output.includes('Client intake (form-1)'));
	});

	test('buddy_list_tags uses tags query and formats tag rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				tags: [{ id: 'tag-1', name: 'Important', color: '#ff0000' }],
			},
		});

		const output = await cap('buddy_list_tags').run({ orgId: 'org-1', limit: 25 }, ctx);

		assert.ok(calls[0].query.includes('tags('));
		assert.ok(output.includes('Important (tag-1)'));
	});

	test('buddy_list_org_trigger_instances uses orgTriggerInstances query and formats instance rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				orgTriggerInstances: [
					{ id: 'instance-1', triggerId: 'trig-1', nextFireTime: '1710000000000', isManualActivation: true },
				],
			},
		});

		const output = await cap('buddy_list_org_trigger_instances').run({ orgId: 'org-1', limit: 25 }, ctx);

		assert.ok(calls[0].query.includes('orgTriggerInstances('));
		assert.ok(output.includes('trigger trig-1 → instance instance-1 next 1710000000000 [manual]'));
	});

	test('buddy_get_trigger_error_status uses getTriggerErrorStatus query and validates triggerIds', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				getTriggerErrorStatus: { t1: true },
			},
		});

		const output = await cap('buddy_get_trigger_error_status').run({ orgId: 'org-1', triggerIds: ['t1'] }, ctx);

		assert.ok(calls[0].query.includes('getTriggerErrorStatus('));
		assert.ok(output.includes('ERROR'));
		await assert.rejects(() => cap('buddy_get_trigger_error_status').run({ orgId: 'org-1' }, ctx), /triggerIds/);
		await assert.rejects(
			() => cap('buddy_get_trigger_error_status').run({ orgId: 'org-1', triggerIds: [] }, ctx),
			/triggerIds/,
		);
	});
});
