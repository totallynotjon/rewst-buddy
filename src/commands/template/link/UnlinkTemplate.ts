import { LinkManager } from '@models';
import { getDocumentFromArgs, log } from '@utils';
import GenericCommand from '../../GenericCommand';

export class UnlinkTemplate extends GenericCommand {
	commandName = 'UnlinkTemplate';

	async execute(...args: any[]): Promise<void> {
		const document = await getDocumentFromArgs(args);
		const uri = document.uri;

		if (!LinkManager.isLinked(uri)) {
			throw log.error(`There is no template link to clear for uri ${uri.toString()}`);
		}

		await LinkManager.removeLink(uri.toString());
		log.notifyInfo(`SUCCESS: Unlinked template from uri ${uri.toString()}`);
	}
}
