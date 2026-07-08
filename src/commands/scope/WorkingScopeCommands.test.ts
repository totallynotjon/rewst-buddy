import { WorkingScopeManager } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import { log } from '@utils';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { ClearWorkingScope } from './ClearWorkingScope';
import { SetWorkingScope } from './SetWorkingScope';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: WorkingScope commands', () => {
	let originalShowQuickPick: typeof vscode.window.showQuickPick;
	let originalNotifyInfo: typeof log.notifyInfo;
	let originalNotifyError: typeof log.notifyError;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
		originalShowQuickPick = vscode.window.showQuickPick;
		originalNotifyInfo = log.notifyInfo;
		originalNotifyError = log.notifyError;
		log.notifyInfo = () => {};
	});

	teardown(() => {
		vscode.window.showQuickPick = originalShowQuickPick;
		log.notifyInfo = originalNotifyInfo;
		log.notifyError = originalNotifyError;
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
	});

	function useSession(orgId = 'org-1', orgName = 'Acme') {
		const { session } = createMockSession({ profile: { org: { id: orgId, name: orgName } } });
		SessionManager._setSessionsForTesting([session]);
	}

	test('SetWorkingScope pins the selected orgs', async () => {
		useSession('org-1', 'Acme');
		vscode.window.showQuickPick = (async (items: readonly { id: string }[]) => {
			const resolved = await items;
			return resolved.filter(item => item.id === 'org-1');
		}) as unknown as typeof vscode.window.showQuickPick;

		await new SetWorkingScope().execute();

		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1']);
	});

	test('SetWorkingScope shows a second picker for pinned workflows and keeps selected ones', async () => {
		useSession('org-1', 'Acme');
		WorkingScopeManager.setWorkflows(['wf-1']);
		let pickCallCount = 0;
		vscode.window.showQuickPick = (async (items: readonly { id?: string }[]) => {
			pickCallCount++;
			const resolved = await items;
			if (pickCallCount === 1) {
				// First pick: org picker — select org-1.
				return resolved.filter(item => item.id === 'org-1');
			}
			// Second pick: workflow picker — keep all.
			return resolved;
		}) as unknown as typeof vscode.window.showQuickPick;

		await new SetWorkingScope().execute();

		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1']);
		assert.deepStrictEqual(
			WorkingScopeManager.getWorkflows(),
			['wf-1'],
			'workflow pin is kept when user selects it',
		);
		assert.strictEqual(pickCallCount, 2, 'two pickers shown when workflows are pinned');
	});

	test('SetWorkingScope removes workflow pins that the user deselects', async () => {
		useSession('org-1', 'Acme');
		WorkingScopeManager.setWorkflows(['wf-1', 'wf-2']);
		let pickCallCount = 0;
		vscode.window.showQuickPick = (async (items: readonly { id?: string }[]) => {
			pickCallCount++;
			const resolved = await items;
			if (pickCallCount === 1) return resolved.filter(item => item.id === 'org-1');
			// Second pick: deselect all workflows.
			return [];
		}) as unknown as typeof vscode.window.showQuickPick;

		await new SetWorkingScope().execute();

		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), [], 'deselected workflows are removed');
	});

	test('SetWorkingScope does not show a workflow picker when no workflows are pinned', async () => {
		useSession('org-1', 'Acme');
		let pickCallCount = 0;
		vscode.window.showQuickPick = (async (items: readonly { id?: string }[]) => {
			pickCallCount++;
			const resolved = await items;
			return resolved.filter(item => item.id === 'org-1');
		}) as unknown as typeof vscode.window.showQuickPick;

		await new SetWorkingScope().execute();

		assert.strictEqual(pickCallCount, 1, 'only one picker shown when no workflows are pinned');
	});

	test('SetWorkingScope lists the orgs already in scope first', async () => {
		const { session } = createMockSession({
			profile: {
				org: { id: 'org-1', name: 'Acme' },
				allManagedOrgs: [
					{ id: 'org-1', name: 'Acme' },
					{ id: 'org-2', name: 'Beta' },
				],
			},
		});
		SessionManager._setSessionsForTesting([session]);
		WorkingScopeManager.setOrgs(['org-2']);

		let captured: readonly { id?: string }[] = [];
		vscode.window.showQuickPick = (async (items: readonly { id?: string }[]) => {
			captured = await items;
			return undefined;
		}) as unknown as typeof vscode.window.showQuickPick;

		await new SetWorkingScope().execute();

		const orgItems = captured.filter(item => typeof item.id === 'string');
		assert.strictEqual(orgItems[0].id, 'org-2', 'the in-scope org sorts to the top');
	});

	test('SetWorkingScope leaves the scope unchanged when cancelled', async () => {
		useSession('org-1');
		WorkingScopeManager.setOrgs(['org-existing']);
		vscode.window.showQuickPick = (async () => undefined) as typeof vscode.window.showQuickPick;

		await new SetWorkingScope().execute();

		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-existing']);
	});

	test('SetWorkingScope reports an error and does nothing without sessions', async () => {
		let errored = false;
		log.notifyError = (() => {
			errored = true;
			return new Error('x');
		}) as typeof log.notifyError;
		let pickShown = false;
		vscode.window.showQuickPick = (async () => {
			pickShown = true;
			return undefined;
		}) as typeof vscode.window.showQuickPick;

		await new SetWorkingScope().execute();

		assert.ok(errored, 'an error notification is shown');
		assert.ok(!pickShown, 'no picker is shown without sessions');
	});

	test('ClearWorkingScope empties the scope', async () => {
		WorkingScopeManager.setOrgs(['org-1']);
		WorkingScopeManager.setWorkflows(['wf-1']);

		await new ClearWorkingScope().execute();

		assert.strictEqual(WorkingScopeManager.isEmpty(), true);
	});
});
