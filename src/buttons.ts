import { context } from '@global';
import { log } from '@log';
import { TemplateLinkManager } from '@models';
import vscode from 'vscode';

export const linkButton: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
export const syncButton: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);

linkButton.command = 'rewst-buddy.LinkTemplate';
linkButton.text = '$(link) Link Template';

syncButton.command = 'rewst-buddy.SyncTemplate';
syncButton.text = '$(sync) Sync Template';

async function checkVisibility(e: vscode.TextEditor | undefined) {
	log.debug('Editor change', e);
	if (e === undefined) {
		linkButton.hide();
		syncButton.hide();
		return;
	}

	const isLinked = TemplateLinkManager.isLinked(e.document.uri);

	if (isLinked) {
		linkButton.hide();
		syncButton.show();
	} else {
		syncButton.hide();
		linkButton.show();
	}
}

export async function activateButtons() {
	context.subscriptions.push(linkButton);
	context.subscriptions.push(syncButton);

	await updateButtonVisibility();
}

export async function updateButtonVisibility(e?: vscode.TextEditor | undefined) {
	await checkVisibility(e ?? vscode.window.activeTextEditor);
}
