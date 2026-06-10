import { SessionManager } from '@sessions';
import { log } from '@utils';
import GenericCommand from '../GenericCommand';

export class ClearSessions extends GenericCommand {
	commandName = 'ClearSessions';

	async execute(...args: unknown[]): Promise<void> {
		await SessionManager.clearProfiles();
		log.notifyInfo('Cleared saved sessions');
	}
}
