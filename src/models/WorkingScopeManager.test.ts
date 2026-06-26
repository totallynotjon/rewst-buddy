import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { WorkingScopeManager } from './WorkingScopeManager';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: WorkingScopeManager', () => {
	setup(() => {
		initTestEnvironment();
		WorkingScopeManager._resetForTesting();
	});

	teardown(() => {
		WorkingScopeManager._resetForTesting();
	});

	test('starts empty', () => {
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), []);
		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), []);
		assert.strictEqual(WorkingScopeManager.isEmpty(), true);
	});

	test('setOrgs replaces, normalizes, and emits a change event', () => {
		let fired: { orgs: string[]; workflows: string[] } | undefined;
		const sub = WorkingScopeManager.onDidChangeScope(state => {
			fired = state;
		});

		WorkingScopeManager.setOrgs(['  org-1  ', 'org-2', 'org-1', '', '   ']);

		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1', 'org-2']);
		assert.strictEqual(WorkingScopeManager.hasOrg('org-1'), true);
		assert.strictEqual(WorkingScopeManager.hasOrg('org-3'), false);
		assert.strictEqual(WorkingScopeManager.isEmpty(), false);
		assert.deepStrictEqual(fired?.orgs, ['org-1', 'org-2']);
		sub.dispose();
	});

	test('setOrgs replaces the previous selection rather than merging', () => {
		WorkingScopeManager.setOrgs(['org-1', 'org-2']);
		WorkingScopeManager.setOrgs(['org-3']);
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-3']);
	});

	test('addOrgs unions with the existing selection', () => {
		WorkingScopeManager.setOrgs(['org-1']);
		WorkingScopeManager.addOrgs(['org-2', 'org-1']);
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1', 'org-2']);
	});

	test('removeOrgs drops the listed ids', () => {
		WorkingScopeManager.setOrgs(['org-1', 'org-2', 'org-3']);
		WorkingScopeManager.removeOrgs(['org-2', 'missing']);
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1', 'org-3']);
	});

	test('workflows are tracked independently and support multiple ids', () => {
		WorkingScopeManager.setWorkflows(['wf-1', 'wf-2', 'wf-1']);
		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), ['wf-1', 'wf-2']);
		assert.strictEqual(WorkingScopeManager.hasWorkflow('wf-1'), true);
		assert.strictEqual(WorkingScopeManager.hasWorkflow('wf-9'), false);
		// Setting workflows leaves orgs untouched.
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), []);
	});

	test('clear empties both sets and emits', () => {
		WorkingScopeManager.setOrgs(['org-1']);
		WorkingScopeManager.setWorkflows(['wf-1']);
		let fired = false;
		const sub = WorkingScopeManager.onDidChangeScope(() => {
			fired = true;
		});
		WorkingScopeManager.clear();
		assert.strictEqual(WorkingScopeManager.isEmpty(), true);
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), []);
		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), []);
		assert.ok(fired);
		sub.dispose();
	});

	test('persists the selection and reloads it from globalState', () => {
		WorkingScopeManager.setOrgs(['org-1', 'org-2']);
		WorkingScopeManager.setWorkflows(['wf-1']);

		// Force a reload from the backing store without resetting state.
		WorkingScopeManager._reloadForTesting();

		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1', 'org-2']);
		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), ['wf-1']);
	});
});
