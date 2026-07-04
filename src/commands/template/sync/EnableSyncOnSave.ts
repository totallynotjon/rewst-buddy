import GenericCommand from '../../GenericCommand';
import { setSyncOnSaveForDocument } from './syncOnSaveCommandCore';

export class EnableSyncOnSave extends GenericCommand {
	commandName = 'EnableSyncOnSave';

	async execute(...args: unknown[]): Promise<void> {
		await setSyncOnSaveForDocument(args, true);
	}
}
