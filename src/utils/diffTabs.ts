import vscode from 'vscode';
import { log } from './log';

/** Closes any open diff tab whose original (left-hand) resource is `originalUri`. */
export async function closeDiffTabsForOriginal(originalUri: vscode.Uri): Promise<void> {
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (
				tab.input instanceof vscode.TabInputTextDiff &&
				tab.input.original.toString() === originalUri.toString()
			) {
				await vscode.window.tabGroups
					.close(tab)
					.then(undefined, err => log.debug('closeDiffTabsForOriginal: failed to close tab', err));
			}
		}
	}
}
