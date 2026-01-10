import { SyncOnSaveManager } from '@models';
import { ensureSavedDocument, log } from '@utils';
import GenericCommand from '../../GenericCommand';

export class DisableSyncOnSave extends GenericCommand {
	commandName = 'DisableSyncOnSave';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);
		const isSyncEnabled = SyncOnSaveManager.isUriSynced(document.uri);
		if (!isSyncEnabled) {
			log.notifyError(`Sync-on-save is not enabled for this file.`);
			return;
		}
		SyncOnSaveManager.disableSync(document.uri);
	}
}
