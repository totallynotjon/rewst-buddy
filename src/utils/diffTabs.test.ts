import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { initTestEnvironment, stub } from '@test';
import { closeDiffTabsForOriginal } from './diffTabs';

const { suite, test, setup } = Mocha;

suite('Unit: diffTabs', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('closeDiffTabsForOriginal no-ops when no matching tab is open', async () => {
		await assert.doesNotReject(() => closeDiffTabsForOriginal(vscode.Uri.file('/no/such/tab.txt')));
	});

	test('closes only the diff tab whose original matches, leaving others open', async () => {
		const target = vscode.Uri.file('/test/target.txt');
		const otherOriginal = vscode.Uri.file('/test/other.txt');
		const remoteFor = (uri: vscode.Uri) => uri.with({ scheme: 'rewst-remote', query: 'rewst-remote=1' });

		const matchingTab = { input: new vscode.TabInputTextDiff(target, remoteFor(target)) };
		const nonMatchingDiffTab = { input: new vscode.TabInputTextDiff(otherOriginal, remoteFor(otherOriginal)) };
		const nonDiffTab = { input: new vscode.TabInputText(target) };

		const closedTabs: unknown[] = [];
		const fakeTabGroups = {
			all: [{ tabs: [nonMatchingDiffTab, matchingTab, nonDiffTab] }],
			close: (tab: unknown) => {
				closedTabs.push(tab);
				return Promise.resolve(true);
			},
		} as unknown as typeof vscode.window.tabGroups;
		const restore = stub(vscode.window, 'tabGroups', fakeTabGroups);

		try {
			await closeDiffTabsForOriginal(target);
		} finally {
			restore();
		}

		assert.strictEqual(closedTabs.length, 1, 'exactly one tab should be closed');
		assert.strictEqual(closedTabs[0], matchingTab, 'only the tab whose original matches must be closed');
	});
});
