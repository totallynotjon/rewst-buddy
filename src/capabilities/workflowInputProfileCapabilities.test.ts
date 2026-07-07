import { clearMockContext, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { CapabilityContext } from './Capability';
import { getCapability } from './registry';

const { suite, test, setup } = Mocha;

// Minimal mock session for local-state capabilities (no GraphQL needed)
function makeMockCtx(orgId = 'org-1'): CapabilityContext {
	return { session: {} as never, orgId, sessions: [] };
}

suite('Unit: workflowInputProfileCapabilities', () => {
	setup(() => {
		const ctx = initTestEnvironment();
		clearMockContext(ctx);
	});

	test('buddy_save_workflow_input_profile saves and returns summary', async () => {
		const cap = getCapability('buddy_save_workflow_input_profile');
		assert.ok(cap, 'capability registered');
		assert.strictEqual(cap.access, 'read', 'local-state capability uses read access');
		const ctx = makeMockCtx();
		const output = await cap.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'smoke', input: { x: 1 } }, ctx);
		assert.ok(output.includes('smoke'), 'output mentions profile name');
		assert.ok(output.includes('wf-1'), 'output mentions workflow id');
	});

	test('buddy_list_workflow_input_profiles lists saved profiles', async () => {
		const saveCap = getCapability('buddy_save_workflow_input_profile');
		const listCap = getCapability('buddy_list_workflow_input_profiles');
		assert.ok(saveCap && listCap);
		const ctx = makeMockCtx();
		await saveCap.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'alpha', input: { a: 1 } }, ctx);
		await saveCap.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'beta', input: { b: 2 } }, ctx);
		const output = await listCap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx);
		assert.ok(output.includes('alpha'), 'output includes alpha');
		assert.ok(output.includes('beta'), 'output includes beta');
		assert.ok(output.includes('2 profile'), 'output mentions count');
	});

	test('buddy_list_workflow_input_profiles returns empty message when none saved', async () => {
		const listCap = getCapability('buddy_list_workflow_input_profiles');
		assert.ok(listCap);
		const output = await listCap.run({ orgId: 'org-1', workflowId: 'wf-empty' }, makeMockCtx());
		assert.ok(output.includes('No saved'), 'output mentions no profiles');
	});

	test('buddy_delete_workflow_input_profile deletes a profile', async () => {
		const saveCap = getCapability('buddy_save_workflow_input_profile');
		const deleteCap = getCapability('buddy_delete_workflow_input_profile');
		const listCap = getCapability('buddy_list_workflow_input_profiles');
		assert.ok(saveCap && deleteCap && listCap);
		const ctx = makeMockCtx();
		await saveCap.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'to-delete', input: {} }, ctx);
		const deleteOutput = await deleteCap.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'to-delete' }, ctx);
		assert.ok(deleteOutput.includes('Deleted'), 'output confirms deletion');
		const listOutput = await listCap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx);
		assert.ok(listOutput.includes('No saved'), 'profile no longer listed');
	});

	test('buddy_delete_workflow_input_profile returns not-found message for missing profile', async () => {
		const deleteCap = getCapability('buddy_delete_workflow_input_profile');
		assert.ok(deleteCap);
		const output = await deleteCap.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'missing' }, makeMockCtx());
		assert.ok(output.includes('No profile'), 'output mentions not found');
	});

	test('buddy_save_workflow_input_profile rejects missing orgId', async () => {
		const cap = getCapability('buddy_save_workflow_input_profile');
		assert.ok(cap);
		await assert.rejects(
			() => cap.run({ workflowId: 'wf-1', name: 'smoke', input: {} }, makeMockCtx()),
			(err: Error) => {
				assert.ok(err.message.includes('orgId'));
				return true;
			},
		);
	});

	test('buddy_save_workflow_input_profile rejects non-object input', async () => {
		const cap = getCapability('buddy_save_workflow_input_profile');
		assert.ok(cap);
		await assert.rejects(
			() => cap.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'smoke', input: 'not-an-object' }, makeMockCtx()),
			(err: Error) => {
				assert.ok(err.message.length > 0);
				return true;
			},
		);
	});
});
