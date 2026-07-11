import { SessionManager, type SessionProfile } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { pickOrganization } from './OrganizationPicker';
import { pickKnownProfile, pickSession } from './SessionPicker';
import { pickTemplate } from './TemplatePicker';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

function stub<T extends object, K extends keyof T>(object: T, key: K, value: T[K]): Restore {
	const original = object[key];
	Object.defineProperty(object, key, { configurable: true, writable: true, value });
	return {
		restore() {
			Object.defineProperty(object, key, { configurable: true, writable: true, value: original });
		},
	};
}

function profile(overrides: Partial<SessionProfile> = {}): SessionProfile {
	const { session } = createMockSession();
	return { ...session.profile, ...overrides };
}

suite('Unit: interactive pickers', () => {
	const restores: Restore[] = [];
	let warnings: string[];

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		warnings = [];
		restores.push(
			stub(vscode.window, 'showWarningMessage', ((message: string) => {
				warnings.push(message);
				return Promise.resolve(undefined);
			}) as unknown as typeof vscode.window.showWarningMessage),
		);
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
		SessionManager._resetForTesting();
	});

	suite('pickSession()', () => {
		test('warns and returns undefined when there are no active sessions', async () => {
			let quickPickCalls = 0;
			restores.push(
				stub(vscode.window, 'showQuickPick', (async () => {
					quickPickCalls++;
					return undefined;
				}) as unknown as typeof vscode.window.showQuickPick),
			);

			assert.strictEqual(await pickSession(), undefined);
			assert.strictEqual(quickPickCalls, 0);
			assert.deepStrictEqual(warnings, ['No sessions available. Add a session first.']);
		});

		test('returns the only active session without interrupting the user with a picker', async () => {
			const { session } = createMockSession();
			SessionManager._setSessionsForTesting([session]);
			let quickPickCalls = 0;
			restores.push(
				stub(vscode.window, 'showQuickPick', (async () => {
					quickPickCalls++;
					return undefined;
				}) as unknown as typeof vscode.window.showQuickPick),
			);

			assert.strictEqual(await pickSession(), session);
			assert.strictEqual(quickPickCalls, 0);
		});

		test('shows labels and org ids for several sessions and returns the selected object', async () => {
			const first = createMockSession({
				profile: { label: 'Same label', org: { id: 'org-a', name: 'A' } },
			}).session;
			const second = createMockSession({
				profile: { label: 'Same label', org: { id: 'org-b', name: 'B' } },
			}).session;
			SessionManager._setSessionsForTesting([first, second]);
			restores.push(
				stub(vscode.window, 'showQuickPick', (async (
					items: readonly { label: string; description: string; session: unknown }[],
					options: vscode.QuickPickOptions,
				) => {
					assert.deepStrictEqual(
						items.map(item => [item.label, item.description]),
						[
							['Same label', 'org-a'],
							['Same label', 'org-b'],
						],
					);
					assert.strictEqual(options.placeHolder, 'Select a session');
					return items[1];
				}) as unknown as typeof vscode.window.showQuickPick),
			);

			assert.strictEqual(await pickSession(), second);
		});

		test('returns undefined when a multi-session picker is cancelled', async () => {
			const first = createMockSession({ profile: { org: { id: 'org-a', name: 'A' } } }).session;
			const second = createMockSession({ profile: { org: { id: 'org-b', name: 'B' } } }).session;
			SessionManager._setSessionsForTesting([first, second]);
			restores.push(
				stub(
					vscode.window,
					'showQuickPick',
					(async () => undefined) as unknown as typeof vscode.window.showQuickPick,
				),
			);

			assert.strictEqual(await pickSession(), undefined);
		});
	});

	suite('pickKnownProfile()', () => {
		test('warns when there are no active or previously authenticated profiles', async () => {
			assert.strictEqual(await pickKnownProfile(), undefined);
			assert.deepStrictEqual(warnings, ['No sessions available.']);
		});

		test('returns one known-only profile without opening a picker', async () => {
			const known = profile({ label: 'Inactive profile' });
			SessionManager._setKnownProfilesForTesting([known]);
			let quickPickCalls = 0;
			restores.push(
				stub(vscode.window, 'showQuickPick', (async () => {
					quickPickCalls++;
					return undefined;
				}) as unknown as typeof vscode.window.showQuickPick),
			);

			assert.strictEqual(await pickKnownProfile(), known);
			assert.strictEqual(quickPickCalls, 0);
		});

		test('marks only known-only profiles inactive and preserves the selected profile', async () => {
			const active = createMockSession({
				profile: { label: 'Active', org: { id: 'org-a', name: 'A' } },
			}).session;
			const inactive = profile({
				label: 'Inactive',
				org: { id: 'org-b', name: 'B' },
				user: { ...active.profile.user, id: 'inactive-user' },
			});
			SessionManager._setSessionsForTesting([active]);
			SessionManager._setKnownProfilesForTesting([active.profile, inactive]);
			restores.push(
				stub(vscode.window, 'showQuickPick', (async (
					items: readonly { description: string; profile: SessionProfile }[],
				) => {
					assert.deepStrictEqual(
						items.map(item => item.description),
						['org-a', 'org-b (inactive)'],
					);
					return items[1];
				}) as unknown as typeof vscode.window.showQuickPick),
			);

			assert.strictEqual(await pickKnownProfile(), inactive);
		});

		test('returns undefined when profile removal selection is cancelled', async () => {
			SessionManager._setKnownProfilesForTesting([profile({ label: 'A' }), profile({ label: 'B' })]);
			restores.push(
				stub(
					vscode.window,
					'showQuickPick',
					(async () => undefined) as unknown as typeof vscode.window.showQuickPick,
				),
			);
			assert.strictEqual(await pickKnownProfile(), undefined);
		});
	});

	suite('pickOrganization()', () => {
		test('returns the primary organization from the first-stage choice', async () => {
			const { session } = createMockSession({ profile: { org: { id: 'primary', name: 'Primary' } } });
			restores.push(
				stub(vscode.window, 'showQuickPick', (async (
					items: readonly { label: string; arguments: boolean[] }[],
				) => {
					assert.deepStrictEqual(
						items.map(item => item.label),
						['Primary', 'Other Organization'],
					);
					return items[0];
				}) as unknown as typeof vscode.window.showQuickPick),
			);

			assert.deepStrictEqual(await pickOrganization(session), { session, org: session.profile.org });
		});

		test('lists managed org objects and returns the exact second-stage selection', async () => {
			const managed = [
				{ id: 'child-a', name: 'Duplicate' },
				{ id: 'child-b', name: 'Duplicate' },
			];
			const { session } = createMockSession({
				profile: { org: { id: 'primary', name: 'Primary' }, allManagedOrgs: managed },
			});
			let stage = 0;
			restores.push(
				stub(vscode.window, 'showQuickPick', (async (items: readonly Record<string, unknown>[]) => {
					stage++;
					if (stage === 1) return items[1];
					assert.deepStrictEqual(
						items.map(item => item.label),
						['Duplicate', 'Duplicate'],
					);
					return items[1];
				}) as unknown as typeof vscode.window.showQuickPick),
			);

			assert.deepStrictEqual(await pickOrganization(session), { session, org: managed[1] });
		});

		test('returns undefined when either selection stage is cancelled', async () => {
			const { session } = createMockSession();
			restores.push(
				stub(
					vscode.window,
					'showQuickPick',
					(async () => undefined) as unknown as typeof vscode.window.showQuickPick,
				),
			);
			assert.strictEqual(await pickOrganization(session), undefined);
			restores.pop()!.restore();

			let stage = 0;
			restores.push(
				stub(vscode.window, 'showQuickPick', (async (items: readonly unknown[]) =>
					++stage === 1 ? items[1] : undefined) as unknown as typeof vscode.window.showQuickPick),
			);
			assert.strictEqual(await pickOrganization(session), undefined);
		});
	});

	suite('pickTemplate()', () => {
		test('warns and returns undefined when an organization has no templates', async () => {
			const { session, wrapper } = createMockSession({ setupDefaults: false });
			wrapper.when('listTemplates', { data: { templates: [] } });

			assert.strictEqual(await pickTemplate(session, session.profile.org), undefined);
			assert.deepStrictEqual(warnings, ['No templates found for this organization.']);
		});

		test('shows template id and description and returns the exact selected template', async () => {
			const templates = [
				{ id: 'template-a', name: 'Duplicate', description: null, updatedAt: '1' },
				{ id: 'template-b', name: 'Duplicate', description: 'Chosen detail', updatedAt: '2' },
			];
			const { session, wrapper } = createMockSession({ setupDefaults: false });
			wrapper.when('listTemplates', { data: { templates } });
			restores.push(
				stub(vscode.window, 'showQuickPick', (async (
					items: readonly { description: string; detail?: string; template: unknown }[],
					options: vscode.QuickPickOptions,
				) => {
					assert.deepStrictEqual(
						items.map(item => [item.description, item.detail]),
						[
							['template-a', undefined],
							['template-b', 'Chosen detail'],
						],
					);
					assert.strictEqual(options.matchOnDescription, true);
					assert.strictEqual(options.matchOnDetail, true);
					return items[1];
				}) as unknown as typeof vscode.window.showQuickPick),
			);

			const result = await pickTemplate(session, session.profile.org);
			assert.strictEqual(result?.template, templates[1]);
			assert.strictEqual(result?.session, session);
			assert.strictEqual(result?.org, session.profile.org);
		});

		test('returns undefined when template selection is cancelled', async () => {
			const { session, wrapper } = createMockSession({ setupDefaults: false });
			wrapper.when('listTemplates', {
				data: { templates: [{ id: 'template-a', name: 'A', description: null, updatedAt: '1' }] },
			});
			restores.push(
				stub(
					vscode.window,
					'showQuickPick',
					(async () => undefined) as unknown as typeof vscode.window.showQuickPick,
				),
			);

			assert.strictEqual(await pickTemplate(session, session.profile.org), undefined);
		});

		test('propagates template lookup failures rather than presenting an empty organization', async () => {
			const { session, wrapper } = createMockSession({ setupDefaults: false });
			wrapper.when('listTemplates', { error: new Error('template transport failed') });

			await assert.rejects(() => pickTemplate(session, session.profile.org), /template transport failed/);
			assert.deepStrictEqual(warnings, []);
		});
	});
});
