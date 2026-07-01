import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { setLastAiAnswer } from '@ui';
import vscode from 'vscode';
import { ApplyRewstAiEdit, applyWithPreview, type ApplyEditDeps } from './ApplyRewstAiEdit';

const { suite, test, setup, teardown } = Mocha;

function recordingDeps(confirmAnswer: boolean): { deps: ApplyEditDeps; order: string[] } {
	const order: string[] = [];
	return {
		order,
		deps: {
			showDiff: async () => {
				order.push('diff');
			},
			confirm: async () => {
				order.push('confirm');
				return confirmAnswer;
			},
			applyEdit: async () => {
				order.push('apply');
				return true;
			},
		},
	};
}

interface BlockPickItem {
	label: string;
	content: string;
}

/** The palette resolution seam: active file + a code block from the last answer. */
function resolveInteractive(): Promise<{ target: vscode.Uri; content: string } | undefined> {
	return (
		new ApplyRewstAiEdit() as unknown as {
			resolveInteractive(): Promise<{ target: vscode.Uri; content: string } | undefined>;
		}
	).resolveInteractive();
}

suite('Unit: ApplyRewstAiEdit', () => {
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	function stubActiveEditor(uri: vscode.Uri): void {
		stub(vscode.window, 'activeTextEditor', { document: { uri } } as unknown as vscode.TextEditor);
	}

	setup(() => {
		initTestEnvironment();
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
	});

	test('the diff preview and confirmation always precede the write', async () => {
		const { deps, order } = recordingDeps(true);
		const applied = await applyWithPreview(vscode.Uri.file('/tmp/example.jinja'), 'new content', deps);
		assert.strictEqual(applied, true);
		assert.deepStrictEqual(order, ['diff', 'confirm', 'apply'], 'a direct-write path fails this assertion');
	});

	test('declining the confirmation never writes', async () => {
		const { deps, order } = recordingDeps(false);
		const applied = await applyWithPreview(vscode.Uri.file('/tmp/example.jinja'), 'new content', deps);
		assert.strictEqual(applied, false);
		assert.deepStrictEqual(order, ['diff', 'confirm']);
	});

	test('a single code block resolves without prompting for a choice', async () => {
		stubActiveEditor(vscode.Uri.file('/tmp/example.jinja'));
		setLastAiAnswer('Try this:\n\n```jinja\n{{ only_block }}\n```');
		let prompted = false;
		stub(vscode.window, 'showQuickPick', (async () => {
			prompted = true;
			return undefined;
		}) as unknown as typeof vscode.window.showQuickPick);

		const resolved = await resolveInteractive();

		assert.strictEqual(prompted, false, 'a single block needs no choice');
		assert.strictEqual(resolved?.content, '{{ only_block }}');
		assert.strictEqual(resolved?.target.path, '/tmp/example.jinja');
	});

	test('several code blocks prompt the user to choose which block to apply', async () => {
		stubActiveEditor(vscode.Uri.file('/tmp/example.jinja'));
		setLastAiAnswer('First:\n```jinja\n{{ first }}\n```\nSecond:\n```yaml\nsecond: true\n```');
		let offered: readonly BlockPickItem[] = [];
		let placeholder: string | undefined;
		stub(vscode.window, 'showQuickPick', (async (
			items: readonly BlockPickItem[],
			options?: vscode.QuickPickOptions,
		) => {
			offered = items;
			placeholder = options?.placeHolder;
			return items[1];
		}) as unknown as typeof vscode.window.showQuickPick);

		const resolved = await resolveInteractive();

		assert.deepStrictEqual(
			offered.map(item => item.label),
			['Block 1 (jinja)', 'Block 2 (yaml)'],
			'every block is offered',
		);
		assert.strictEqual(placeholder, 'Which code block should be applied?');
		assert.strictEqual(resolved?.content, 'second: true', 'the chosen block is returned');
	});
});
