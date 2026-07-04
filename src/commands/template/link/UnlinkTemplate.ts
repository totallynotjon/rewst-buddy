import { getDocumentFromArgs } from '@utils';
import { removeLinkForUri } from '../../linkCore';
import GenericCommand from '../../GenericCommand';

export class UnlinkTemplate extends GenericCommand {
	commandName = 'UnlinkTemplate';

	async execute(...args: any[]): Promise<void> {
		const document = await getDocumentFromArgs(args);
		const uri = document.uri;

		await removeLinkForUri(
			uri,
			`There is no template link to clear for uri ${uri.toString()}`,
			`SUCCESS: Unlinked template from uri ${uri.toString()}`,
		);
	}
}
