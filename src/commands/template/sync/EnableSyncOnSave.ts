import { SyncOnSaveManager } from '@models';
import { ensureSavedDocument, log } from '@utils';
import GenericCommand from '../../GenericCommand';

export class EnableSyncOnSave extends GenericCommand {
	commandName = 'EnableSyncOnSave';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);
		const isSyncEnabled = SyncOnSaveManager.isUriSynced(document.uri);
		if (isSyncEnabled) {
			log.notifyError(`Sync-on-save is already enabled for this file.`);
			return;
		}
		SyncOnSaveManager.enableSync(document.uri);
	}
}
