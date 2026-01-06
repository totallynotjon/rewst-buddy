import { FolderLink, LinkManager, SyncManager } from '@models';
import { pickOrganization } from '@ui';
import { log, parseArgsUri } from '@utils';
import GenericCommand from '../../GenericCommand';

export class LinkFolder extends GenericCommand {
	commandName = 'LinkFolder';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);

		const orgPick = await pickOrganization();
		if (!orgPick) return;

		const link: FolderLink = {
			type: 'Folder',
			uriString: uri.toString(),
			org: orgPick.org,
		};
		await LinkManager.addLink(link).save();
		log.notifyInfo('SUCCESS: Linked folder');

		try {
			await SyncManager.fetchFolder(link);
		} catch (e) {
			log.notifyError('Failed to fetch templates for linked folder', e);
		}
	}
}
