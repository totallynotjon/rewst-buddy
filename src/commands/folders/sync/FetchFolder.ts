import { LinkManager, SyncManager } from '@models';
import { log, parseArgsUri } from '@utils';
import GenericCommand from '../../GenericCommand';

export class FetchFolder extends GenericCommand {
	commandName = 'FetchFolder';

	async execute(...args: any[]): Promise<void> {
		log.trace('FetchFolder: starting');

		const uri = parseArgsUri(args);
		log.debug('FetchFolder: fetching', uri.fsPath);

		const folderLink = LinkManager.getFolderLink(uri);

		try {
			await SyncManager.fetchFolder(folderLink);
			log.trace('FetchFolder: completed');
		} catch (e) {
			log.notifyError('FetchFolder: failed', e);
		}
	}
}
