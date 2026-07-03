import GenericCommand from '../../GenericCommand';
import { setSyncOnSaveForDocument } from './syncOnSaveCommandCore';

export class DisableSyncOnSave extends GenericCommand {
	commandName = 'DisableSyncOnSave';

	async execute(...args: unknown[]): Promise<void> {
		await setSyncOnSaveForDocument(args, false);
	}
}
