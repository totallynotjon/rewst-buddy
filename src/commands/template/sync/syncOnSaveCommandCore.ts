import { SyncOnSaveManager } from '@models';
import { ensureSavedDocument, log } from '@utils';

export async function setSyncOnSaveForDocument(args: unknown[], enabled: boolean): Promise<void> {
	const document = await ensureSavedDocument(args);
	const isSyncEnabled = SyncOnSaveManager.isUriSynced(document.uri);

	if (enabled && isSyncEnabled) {
		log.notifyError('Sync-on-save is already enabled for this file.');
		return;
	}

	if (!enabled && !isSyncEnabled) {
		log.notifyError('Sync-on-save is not enabled for this file.');
		return;
	}

	if (enabled) {
		SyncOnSaveManager.enableSync(document.uri);
	} else {
		SyncOnSaveManager.disableSync(document.uri);
	}
}
