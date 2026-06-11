import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import vscode from 'vscode';
import { applyWithPreview, type ApplyEditDeps } from './ApplyRewstAiEdit';

const { suite, test, setup } = Mocha;

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

suite('Unit: ApplyRewstAiEdit', () => {
	setup(() => {
		initTestEnvironment();
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
});
