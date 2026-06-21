import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { Session } from '@sessions';
import type { CapabilityContext } from './Capability';
import { TRIGGER_FORM_CAPABILITIES } from './triggerFormCapabilities';
const { suite, test, setup } = Mocha;
function fakeCtx(response: unknown) {
	const calls: { query: string; variables: Record<string, unknown> }[] = [];
	const session = {
		rawGraphql: async (query: string, variables: Record<string, unknown>) => {
			calls.push({ query, variables });
			return response as { data?: unknown; errors?: unknown };
		},
	} as unknown as Session;
	const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
	return { ctx, calls };
}
function cap(name: string) {
	const c = TRIGGER_FORM_CAPABILITIES.find(x => x.spec.name === name);
	if (!c) throw new Error('missing ' + name);
	return c;
}
suite('Unit: triggerFormCapabilities', () => {
	setup(() => initTestEnvironment());

	test('list_triggers uses triggers query and formats trigger rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				triggers: [
					{ id: 'trig-1', name: 'Alert trigger', enabled: true, triggerTypeId: 'type-1', workflowId: 'wf-1' },
				],
			},
		});

		const output = await cap('list_triggers').run({ orgId: 'org-1', limit: 25 }, ctx);

		assert.ok(calls[0].query.includes('triggers('));
		assert.ok(output.includes('Alert trigger (trig-1) → workflow wf-1'));
	});

	test('list_forms uses forms query and formats form rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				forms: [{ id: 'form-1', name: 'Client intake', updatedAt: '1710000000000' }],
			},
		});

		const output = await cap('list_forms').run({ orgId: 'org-1', limit: 25 }, ctx);

		assert.ok(calls[0].query.includes('forms('));
		assert.ok(output.includes('Client intake (form-1)'));
	});

	test('list_tags uses tags query and formats tag rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				tags: [{ id: 'tag-1', name: 'Important', color: '#ff0000' }],
			},
		});

		const output = await cap('list_tags').run({ orgId: 'org-1', limit: 25 }, ctx);

		assert.ok(calls[0].query.includes('tags('));
		assert.ok(output.includes('Important (tag-1)'));
	});

	test('list_org_trigger_instances uses orgTriggerInstances query and formats instance rows', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				orgTriggerInstances: [
					{ id: 'instance-1', triggerId: 'trig-1', nextFireTime: '1710000000000', isManualActivation: true },
				],
			},
		});

		const output = await cap('list_org_trigger_instances').run({ orgId: 'org-1', limit: 25 }, ctx);

		assert.ok(calls[0].query.includes('orgTriggerInstances('));
		assert.ok(output.includes('trigger trig-1 → instance instance-1 next 1710000000000 [manual]'));
	});

	test('get_trigger_error_status uses getTriggerErrorStatus query and validates triggerIds', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				getTriggerErrorStatus: { t1: true },
			},
		});

		const output = await cap('get_trigger_error_status').run({ orgId: 'org-1', triggerIds: ['t1'] }, ctx);

		assert.ok(calls[0].query.includes('getTriggerErrorStatus('));
		assert.ok(output.includes('ERROR'));
		await assert.rejects(() => cap('get_trigger_error_status').run({ orgId: 'org-1' }, ctx), /triggerIds/);
		await assert.rejects(
			() => cap('get_trigger_error_status').run({ orgId: 'org-1', triggerIds: [] }, ctx),
			/triggerIds/,
		);
	});
});
