import { LinkManager } from '@models';
import { log, parseArgsUri } from '@utils';
import GenericCommand from '../../GenericCommand';

export class UnlinkFolder extends GenericCommand {
	commandName = 'UnlinkFolder';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);

		if (!LinkManager.isLinked(uri)) {
			throw log.error(`There is no link to clear for uri ${uri.toString()}`);
		}

		await LinkManager.removeLink(uri.toString());
		log.notifyInfo(`SUCCESS: Unlinked folder from uri ${uri.toString()}`);
	}
}
