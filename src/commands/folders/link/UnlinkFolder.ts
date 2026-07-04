import { parseArgsUri } from '@utils';
import { removeLinkForUri } from '../../linkCore';
import GenericCommand from '../../GenericCommand';

export class UnlinkFolder extends GenericCommand {
	commandName = 'UnlinkFolder';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);

		await removeLinkForUri(
			uri,
			`There is no link to clear for uri ${uri.toString()}`,
			`SUCCESS: Unlinked folder from uri ${uri.toString()}`,
		);
	}
}
