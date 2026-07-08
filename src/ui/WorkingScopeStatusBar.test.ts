import * as assert from 'assert';
import * as Mocha from 'mocha';
import { WorkingScopeManager } from '@models';
import { initTestEnvironment } from '@test';
import vscode from 'vscode';
import { WorkingScopeStatusBar } from './WorkingScopeStatusBar';

const { suite, test, setup, teardown } = Mocha;

function itemOf(bar: WorkingScopeStatusBar): vscode.StatusBarItem {
	return (bar as unknown as { item: vscode.StatusBarItem }).item;
}

suite('Unit: WorkingScopeStatusBar', () => {
	let bar: WorkingScopeStatusBar | undefined;

	setup(() => {
		initTestEnvironment();
		WorkingScopeManager._resetForTesting();
	});

	teardown(() => {
		bar?.dispose();
		bar = undefined;
		WorkingScopeManager._resetForTesting();
	});

	test('shows the unset state and wires the Set Working Scope command', () => {
		bar = new WorkingScopeStatusBar();
		const item = itemOf(bar);
		assert.match(item.text, /unset/);
		assert.strictEqual(item.command, 'rewst-buddy.SetWorkingScope');
	});

	test('refreshes to show pinned orgs and workflows on a scope change', () => {
		bar = new WorkingScopeStatusBar();
		WorkingScopeManager.setOrgs(['org-1']);
		WorkingScopeManager.setWorkflows(['wf-1', 'wf-2']);
		const item = itemOf(bar);
		assert.match(item.text, /1 org\b/);
		assert.match(item.text, /2 workflows/);
	});

	test('tooltip shows workflow name when available, raw id as fallback', () => {
		bar = new WorkingScopeStatusBar();
		WorkingScopeManager.applyChange({ workflows: ['wf-named', 'wf-raw'] }, [
			{ id: 'wf-named', name: 'My Workflow' },
		]);
		const tooltip = itemOf(bar).tooltip as vscode.MarkdownString;
		assert.ok(tooltip.value.includes('My Workflow (wf-named)'), 'named workflow shows name (id)');
		assert.ok(tooltip.value.includes('wf-raw'), 'unnamed workflow falls back to raw id');
		assert.ok(!tooltip.value.includes('wf-raw (wf-raw)'), 'no double-id for unnamed workflow');
	});

	test('returns to the unset label when the scope is cleared', () => {
		bar = new WorkingScopeStatusBar();
		WorkingScopeManager.setOrgs(['org-1']);
		WorkingScopeManager.clear();
		assert.match(itemOf(bar).text, /unset/);
	});

	test('dispose cleans up without throwing', () => {
		const local = new WorkingScopeStatusBar();
		assert.doesNotThrow(() => local.dispose());
	});
});
