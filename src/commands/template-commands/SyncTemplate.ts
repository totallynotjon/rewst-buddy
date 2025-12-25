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

		if (editor.document.isUntitled) {
			log.notifyError('Attempting sync before document is titled/saved to disk. This should be impossible.');
			return;
		}

		if (editor.document.isDirty) {
			const resultUri = await vscode.workspace.save(editor.document.uri);

			if (!resultUri) {
				throw log.error('Failed to save the active editor before attempting sync');
			}
		}

		try {
			await TemplateSyncManager.syncTemplate(editor);
			log.notifyInfo('SUCCESS: Synced template');
		} catch (e) {
			log.notifyError('Failed to sync template:', e);
		}
	}
}
