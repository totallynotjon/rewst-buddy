import { SyncManager } from '@models';
import { getDocumentFromArgs, log } from '@utils';
import GenericCommand from '../../GenericCommand';

export class SyncTemplate extends GenericCommand {
	commandName = 'SyncTemplate';

	async execute(...args: any[]): Promise<void> {
		log.trace('SyncTemplate: starting');
		const document = await getDocumentFromArgs(args);
		log.debug('SyncTemplate: syncing', document.uri.fsPath);

		try {
			await SyncManager.syncTemplate(document);
			log.notifyInfo('SUCCESS: Synced template');
		} catch (e) {
			log.notifyError('Failed to sync template:', e);
		}
	}
}
