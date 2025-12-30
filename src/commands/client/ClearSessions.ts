import { SessionManager } from '@client';
import { log } from '@utils';
import GenericCommand from '../GenericCommand';

export class ClearSessions extends GenericCommand {
	commandName = 'ClearSessions';

	async execute(...args: unknown[]): Promise<void> {
		SessionManager.clearProfiles();
		log.notifyInfo('Cleared saved sessions');
	}
}
