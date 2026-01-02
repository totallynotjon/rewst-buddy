import { extPrefix } from '@global';
import { SyncOnSaveManager } from '@models';
import { ensureSavedDocument, log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';

export class RemoveSyncExclusion extends GenericCommand {
	commandName = 'RemoveSyncExclusion';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);
		if (!SyncOnSaveManager.globalEnabled) {
			await vscode.commands.executeCommand('workbench.action.openSettings', `${extPrefix}.enableSyncOnSave`);
			return;
		}

		const isSyncEnabled = SyncOnSaveManager.isUriSynced(document.uri);
		if (isSyncEnabled) {
			log.notifyError(`This file does not have a sync exclusion to remove`);
			return;
		}
		await SyncOnSaveManager.removeExclusion(document.uri);
	}
}
