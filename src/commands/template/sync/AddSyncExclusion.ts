import { SyncOnSaveManager } from '@models';
import { ensureSavedDocument, log } from '@utils';
import GenericCommand from '../../GenericCommand';

export class AddSyncExclusion extends GenericCommand {
	commandName = 'AddSyncExclusion';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);
		const isSyncEnabled = SyncOnSaveManager.isUriSynced(document.uri);
		if (!isSyncEnabled) {
			log.notifyError(`This file already has an exclusion for sync on save.`);
			return;
		}
		await SyncOnSaveManager.addExclusion(document.uri);
	}
}
