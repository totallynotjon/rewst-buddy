import { log } from '@log';
import { TemplateSyncManager } from '@models';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class SyncTemplate extends GenericCommand {
	commandName = 'SyncTemplate';

	async execute(...args: unknown[]): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (editor === undefined) {
			throw log.error('No active editor to update');
		}

		try {
			await TemplateSyncManager.syncTemplate(editor.document);
			log.notifyInfo('SUCCESS: Synced template');
		} catch (e) {
			log.notifyError('Failed to sync template:', e);
		}
	}
}
