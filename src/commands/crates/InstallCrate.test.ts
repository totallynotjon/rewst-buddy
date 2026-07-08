import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import type { CrateDetail, CrateTokenDetail } from '../../crates/crateUnpack';
import { collectTokenValues, crateQuickPickItems, promptInputToken, promptSelectToken } from './InstallCrate';

const { suite, test, setup, teardown } = Mocha;

function token(overrides: Partial<CrateTokenDetail> = {}): CrateTokenDetail {
	return {
		id: 'tok-1',
		name: 'Token One',
		type: 'inputVar',
		index: 0,
		options: [],
		...overrides,
	};
}

function crate(overrides: Partial<CrateDetail> = {}): CrateDetail {
	return {
		id: 'crate-1',
		name: 'User Onboarding',
		requiredOrgVariables: [],
		tokens: [],
		crateTriggers: [],
		...overrides,
	};
}

suite('Unit: InstallCrate wizard helpers', () => {
	const originalShowQuickPick = vscode.window.showQuickPick;
	const originalShowInputBox = vscode.window.showInputBox;

	setup(() => {
		initTestEnvironment();
	});

	teardown(() => {
		vscode.window.showQuickPick = originalShowQuickPick;
		vscode.window.showInputBox = originalShowInputBox;
	});

	suite('crateQuickPickItems()', () => {
		test('maps rows, drops id-less rows, and marks installed crates', () => {
			const items = crateQuickPickItems([
				{ id: 'c-1', name: 'Alpha', category: 'Ops', description: 'First', isUnpackedForSelectedOrg: false },
				{ id: 'c-2', name: 'Beta', category: null, description: null, isUnpackedForSelectedOrg: true },
				{ id: null, name: 'Ghost' },
			]);
			assert.strictEqual(items.length, 2, 'row without an id is dropped');

			assert.strictEqual(items[0].crateId, 'c-1');
			assert.strictEqual(items[0].label, 'Alpha');
			assert.strictEqual(items[0].description, 'Ops');
			assert.strictEqual(items[0].detail, 'First');

			assert.strictEqual(items[1].crateId, 'c-2');
			assert.strictEqual(items[1].label, '$(check) Beta', 'installed crates carry the check icon');
			assert.strictEqual(items[1].description, 'already installed');
		});
	});

	suite('promptSelectToken()', () => {
		test('single-select offers option labels with the default tagged and returns the picked value', async () => {
			let seenItems: readonly { label: string; description?: string; value: string }[] = [];
			let seenOptions: { placeHolder?: string; canPickMany?: boolean } = {};
			vscode.window.showQuickPick = (async (items: never, options: never) => {
				seenItems = await items;
				seenOptions = options ?? {};
				return seenItems[1];
			}) as unknown as typeof vscode.window.showQuickPick;

			const value = await promptSelectToken(
				token({
					name: 'Region',
					type: 'selectVar',
					options: [
						{ id: 'o-1', label: 'US East', value: 'us-east', isDefault: true },
						{ id: 'o-2', label: 'EU West', value: 'eu-west', isDefault: false },
						{ id: 'o-3', label: 'Broken', value: undefined, isDefault: false },
					],
				}),
			);

			assert.strictEqual(value, 'eu-west');
			assert.strictEqual(seenOptions.placeHolder, 'Region');
			assert.notStrictEqual(seenOptions.canPickMany, true);
			assert.deepStrictEqual(
				seenItems.map(item => item.label),
				['US East', 'EU West'],
				'value-less options are dropped',
			);
			assert.strictEqual(seenItems[0].description, 'default', 'default option is tagged');
		});

		test('multiselect preselects defaults and returns every picked value', async () => {
			let seenItems: readonly { picked?: boolean; value: string }[] = [];
			vscode.window.showQuickPick = (async (items: never, options: { canPickMany?: boolean }) => {
				seenItems = await items;
				assert.strictEqual(options.canPickMany, true, 'multiselect uses canPickMany');
				return seenItems.filter(item => item.picked);
			}) as unknown as typeof vscode.window.showQuickPick;

			const value = await promptSelectToken(
				token({
					name: 'Channels',
					type: 'selectVar',
					isMultiselect: true,
					options: [
						{ id: 'o-1', label: 'General', value: 'general', isDefault: true },
						{ id: 'o-2', label: 'Alerts', value: 'alerts', isDefault: true },
						{ id: 'o-3', label: 'Random', value: 'random', isDefault: false },
					],
				}),
			);

			assert.deepStrictEqual(value, ['general', 'alerts'], 'default options come back preselected');
			assert.deepStrictEqual(
				seenItems.map(item => item.picked),
				[true, true, false],
			);
		});
	});

	suite('promptInputToken()', () => {
		test('prefills the token default and hint', async () => {
			let seenOptions: { prompt?: string; value?: string; placeHolder?: string } = {};
			vscode.window.showInputBox = (async (options: never) => {
				seenOptions = options ?? {};
				return 'typed value';
			}) as unknown as typeof vscode.window.showInputBox;

			const value = await promptInputToken(
				token({ name: 'Team Name', value: 'Acme Default', previewText: 'e.g. Contoso' }),
			);

			assert.strictEqual(value, 'typed value');
			assert.strictEqual(seenOptions.prompt, 'Team Name');
			assert.strictEqual(seenOptions.value, 'Acme Default', 'default prefilled');
			assert.strictEqual(seenOptions.placeHolder, 'e.g. Contoso');
		});
	});

	suite('collectTokenValues()', () => {
		test('walks value tokens in wizard order with step labels, keying values by token id', async () => {
			const prompts: string[] = [];
			vscode.window.showInputBox = (async (options: { prompt?: string }) => {
				prompts.push(options.prompt ?? '');
				return `answer-${prompts.length}`;
			}) as unknown as typeof vscode.window.showInputBox;
			vscode.window.showQuickPick = (async (items: never, options: { placeHolder?: string }) => {
				prompts.push(options.placeHolder ?? '');
				const resolved = (await items) as { value: string }[];
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick;

			const values = await collectTokenValues(
				crate({
					tokens: [
						token({ id: 'tok-note', name: 'Note', type: 'text', index: 0 }),
						token({ id: 'tok-team', name: 'Team', type: 'inputVar', index: 1 }),
						token({
							id: 'tok-region',
							name: 'Region',
							type: 'selectVar',
							index: 2,
							options: [{ id: 'o-1', label: 'US', value: 'us', isDefault: true }],
						}),
					],
				}),
			);

			// Display-only token is skipped; both value tokens prompt in order with
			// step labels counting only the value tokens.
			assert.deepStrictEqual(prompts, ['Team (1/2)', 'Region (2/2)']);
			assert.deepStrictEqual(values, { 'tok-team': 'answer-1', 'tok-region': 'us' });
		});

		test('cancelling any step aborts with undefined', async () => {
			vscode.window.showInputBox = (async () => undefined) as unknown as typeof vscode.window.showInputBox;

			const values = await collectTokenValues(
				crate({ tokens: [token({ id: 'tok-team', name: 'Team', type: 'inputVar' })] }),
			);

			assert.strictEqual(values, undefined);
		});
	});
});
