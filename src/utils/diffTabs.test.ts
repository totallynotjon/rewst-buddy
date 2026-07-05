import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { closeDiffTabsForOriginal } from './diffTabs';

const { suite, test } = Mocha;

suite('Unit: diffTabs', () => {
	test('closeDiffTabsForOriginal no-ops when no matching tab is open', async () => {
		await assert.doesNotReject(() => closeDiffTabsForOriginal(vscode.Uri.file('/no/such/tab.txt')));
	});
});
