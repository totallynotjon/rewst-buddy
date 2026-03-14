import { SyncManager } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';

export class SyncTemplate extends GenericCommand {
	commandName = 'SyncTemplate';

	async execute(...args: any[]): Promise<void> {
		log.trace('SyncTemplate: starting');
		let document: vscode.TextDocument;

		// If invoked from context menu, first arg is the file URI
		if (args[0][0] instanceof vscode.Uri) {
			log.trace('SyncTemplate: invoked from context menu');
			document = await vscode.workspace.openTextDocument(args[0][0]);
		} else {
			log.trace('SyncTemplate: invoked from command palette');
			const editor = vscode.window.activeTextEditor;
			if (editor === undefined) {
				throw log.error('SyncTemplate: no active editor');
			}
			document = editor.document;
		}

		log.debug('SyncTemplate: syncing', document.uri.fsPath);

		try {
			await SyncManager.syncTemplate(document);
			log.notifyInfo('SUCCESS: Synced template');
		} catch (e) {
			log.notifyError('Failed to sync template:', e);
		}
	}
}
