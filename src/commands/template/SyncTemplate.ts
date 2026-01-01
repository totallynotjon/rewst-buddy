import { TemplateSyncManager } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class SyncTemplate extends GenericCommand {
	commandName = 'SyncTemplate';

	async execute(...args: any[]): Promise<void> {
		let document: vscode.TextDocument;

		// If invoked from context menu, first arg is the file URI
		if (args[0][0] instanceof vscode.Uri) {
			document = await vscode.workspace.openTextDocument(args[0][0]);
		} else {
			const editor = vscode.window.activeTextEditor;
			if (editor === undefined) {
				throw log.error('No active editor to update');
			}
			document = editor.document;
		}

		try {
			await TemplateSyncManager.syncTemplate(document);
			log.notifyInfo('SUCCESS: Synced template');
		} catch (e) {
			log.notifyError('Failed to sync template:', e);
		}
	}
}
