import { SessionManager } from '@sessions';
import { SessionTreeItem } from '@ui';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { RemoveSession } from './RemoveSession';

const { suite, test, setup, teardown } = Mocha;

/**
 * RemoveSession drives the "remove one authenticated or previously
 * authenticated session" flow (issue #111): resolve a profile from a
 * Sessions-tree context menu item or, from the command palette, a quick pick
 * across every known profile, confirm with a modal, then delegate to
 * SessionManager.removeSession.
 */
suite('Unit: RemoveSession', () => {
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	function stubConfirm(response: 'Remove' | undefined): void {
		stub(
			vscode.window,
			'showWarningMessage',
			(async () => response) as unknown as typeof vscode.window.showWarningMessage,
		);
	}

	function stubQuickPick(selectLabel: string | undefined): void {
		stub(vscode.window, 'showQuickPick', (async (items: { label: string }[]) =>
			selectLabel === undefined
				? undefined
				: items.find(item => item.label === selectLabel)) as unknown as typeof vscode.window.showQuickPick);
	}

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		SessionManager._resetForTesting();
	});

	test('removes the session for a Sessions-tree context menu item after confirmation', async () => {
		const { session } = createMockSession({
			profile: {
				user: Fixtures.userFragment({ id: 'user-tree-remove' }),
				org: { id: 'org-tree-remove', name: 'Tree Remove' },
				allManagedOrgs: [{ id: 'org-tree-remove', name: 'Tree Remove' }],
			},
		});
		SessionManager._setSessionsForTesting([session]);
		const item = new SessionTreeItem(session.profile, true, vscode.TreeItemCollapsibleState.None);
		stubConfirm('Remove');

		await new RemoveSession().execute([item]);

		assert.strictEqual(SessionManager.getActiveSessions().length, 0);
		assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
	});

	test('does nothing when the user dismisses the confirmation', async () => {
		const { session } = createMockSession({
			profile: {
				user: Fixtures.userFragment({ id: 'user-keep' }),
				org: { id: 'org-keep', name: 'Keep' },
				allManagedOrgs: [{ id: 'org-keep', name: 'Keep' }],
			},
		});
		SessionManager._setSessionsForTesting([session]);
		const item = new SessionTreeItem(session.profile, true, vscode.TreeItemCollapsibleState.None);
		stubConfirm(undefined);

		await new RemoveSession().execute([item]);

		assert.strictEqual(SessionManager.getActiveSessions().length, 1);
	});

	test('falls back to a picker across known profiles when run from the command palette', async () => {
		const { session } = createMockSession({
			profile: {
				user: Fixtures.userFragment({ id: 'user-palette' }),
				org: { id: 'org-palette', name: 'Palette Org' },
				allManagedOrgs: [{ id: 'org-palette', name: 'Palette Org' }],
			},
		});
		SessionManager._setKnownProfilesForTesting([session.profile]);
		stubConfirm('Remove');

		await new RemoveSession().execute();

		assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
	});

	test('picks the selected profile out of several known profiles and removes only it', async () => {
		const { session: keep } = createMockSession({
			profile: {
				label: 'Keep Me',
				user: Fixtures.userFragment({ id: 'user-multi-keep' }),
				org: { id: 'org-multi-keep', name: 'Keep Me' },
				allManagedOrgs: [{ id: 'org-multi-keep', name: 'Keep Me' }],
			},
		});
		const { session: remove } = createMockSession({
			profile: {
				label: 'Remove Me',
				user: Fixtures.userFragment({ id: 'user-multi-remove' }),
				org: { id: 'org-multi-remove', name: 'Remove Me' },
				allManagedOrgs: [{ id: 'org-multi-remove', name: 'Remove Me' }],
			},
		});
		SessionManager._setKnownProfilesForTesting([keep.profile, remove.profile]);
		stubQuickPick('Remove Me');
		stubConfirm('Remove');

		await new RemoveSession().execute();

		const remaining = SessionManager.getAllKnownProfiles();
		assert.strictEqual(remaining.length, 1);
		assert.strictEqual(remaining[0].user.id, 'user-multi-keep');
	});

	test('does nothing when there are no known sessions to remove', async () => {
		await new RemoveSession().execute();

		assert.strictEqual(SessionManager.getActiveSessions().length, 0);
		assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
	});
});
