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
	log.debug('Editor change');
	if (e === undefined) {
		linkButton.hide();
		syncButton.hide();
		return;
	}
	const uri = e.document.uri;

	const isLinked = TemplateLinkManager.getLink(uri);

	if (isLinked !== undefined) {
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
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(checkVisibility));

	await checkVisibility(vscode.window.activeTextEditor);
}

export async function updateButtonVisibility() {
	await checkVisibility(vscode.window.activeTextEditor);
}
