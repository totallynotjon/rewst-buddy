import { LinkManager, SyncManager } from '@models';
import { log, parseArgsUri } from '@utils';
import GenericCommand from '../../GenericCommand';

export class FetchFolder extends GenericCommand {
	commandName = 'FetchFolder';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);

		const folderLink = LinkManager.getFolderLink(uri);

		try {
			await SyncManager.fetchFolder(folderLink);
		} catch (e) {
			log.notifyError('Failed to fetch folder', e);
		}
	}
}
