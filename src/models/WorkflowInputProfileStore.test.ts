import { clearMockContext, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { WORKFLOW_INPUT_PROFILES_KEY, WorkflowInputProfileStore } from './WorkflowInputProfileStore';

const { suite, test, setup } = Mocha;

suite('Unit: WorkflowInputProfileStore', () => {
	setup(() => {
		const ctx = initTestEnvironment();
		clearMockContext(ctx);
	});

	test('saves a profile and retrieves it', () => {
		const profile = WorkflowInputProfileStore.save('org-1', 'wf-1', 'smoke', { x: 1 });
		assert.strictEqual(profile.name, 'smoke');
		assert.deepStrictEqual(profile.input, { x: 1 });
		const retrieved = WorkflowInputProfileStore.get('org-1', 'wf-1', 'smoke');
		assert.ok(retrieved);
		assert.deepStrictEqual(retrieved.input, { x: 1 });
	});

	test('overwrites a profile with the same name', () => {
		WorkflowInputProfileStore.save('org-1', 'wf-1', 'smoke', { x: 1 });
		WorkflowInputProfileStore.save('org-1', 'wf-1', 'smoke', { x: 2 });
		const retrieved = WorkflowInputProfileStore.get('org-1', 'wf-1', 'smoke');
		assert.ok(retrieved);
		assert.deepStrictEqual(retrieved.input, { x: 2 }, 'second save overwrites first');
		const list = WorkflowInputProfileStore.list('org-1', 'wf-1');
		assert.strictEqual(list.length, 1, 'only one profile after overwrite');
	});

	test('lists profiles sorted by name', () => {
		WorkflowInputProfileStore.save('org-1', 'wf-1', 'zebra', { z: 1 });
		WorkflowInputProfileStore.save('org-1', 'wf-1', 'alpha', { a: 1 });
		WorkflowInputProfileStore.save('org-1', 'wf-1', 'middle', { m: 1 });
		const list = WorkflowInputProfileStore.list('org-1', 'wf-1');
		assert.deepStrictEqual(
			list.map(p => p.name),
			['alpha', 'middle', 'zebra'],
			'profiles sorted by name',
		);
	});

	test('deletes a profile', () => {
		WorkflowInputProfileStore.save('org-1', 'wf-1', 'to-delete', { x: 1 });
		const deleted = WorkflowInputProfileStore.delete('org-1', 'wf-1', 'to-delete');
		assert.strictEqual(deleted, true);
		assert.strictEqual(WorkflowInputProfileStore.get('org-1', 'wf-1', 'to-delete'), undefined);
	});

	test('delete returns false for non-existent profile', () => {
		const deleted = WorkflowInputProfileStore.delete('org-1', 'wf-1', 'missing');
		assert.strictEqual(deleted, false);
	});

	test('rejects blank name', () => {
		assert.throws(() => WorkflowInputProfileStore.save('org-1', 'wf-1', '  ', { x: 1 }), /blank/);
	});

	test('trims a profile name before saving and lookup', () => {
		const profile = WorkflowInputProfileStore.save('org-1', 'wf-1', ' smoke ', { x: 1 });
		assert.strictEqual(profile.name, 'smoke');
		assert.deepStrictEqual(WorkflowInputProfileStore.get('org-1', 'wf-1', 'smoke')?.input, { x: 1 });
		assert.strictEqual(WorkflowInputProfileStore.get('org-1', 'wf-1', ' smoke '), undefined);
	});

	test('persists under RewstWorkflowInputProfiles key', () => {
		const ctx = initTestEnvironment();
		clearMockContext(ctx);
		WorkflowInputProfileStore.save('org-1', 'wf-1', 'test', { x: 1 });
		const stored = ctx.globalState.get(WORKFLOW_INPUT_PROFILES_KEY) as Record<string, unknown>;
		assert.ok(
			stored && Object.keys(stored).some(key => key.includes('test')),
			'profile persisted under the documented key',
		);
	});

	test('profiles are scoped by orgId and workflowId', () => {
		WorkflowInputProfileStore.save('org-1', 'wf-1', 'shared-name', { org: 1 });
		WorkflowInputProfileStore.save('org-2', 'wf-1', 'shared-name', { org: 2 });
		WorkflowInputProfileStore.save('org-1', 'wf-2', 'shared-name', { wf: 2 });
		const list1 = WorkflowInputProfileStore.list('org-1', 'wf-1');
		assert.strictEqual(list1.length, 1);
		assert.deepStrictEqual(list1[0].input, { org: 1 });
		const list2 = WorkflowInputProfileStore.list('org-2', 'wf-1');
		assert.strictEqual(list2.length, 1);
		assert.deepStrictEqual(list2[0].input, { org: 2 });
	});
});
