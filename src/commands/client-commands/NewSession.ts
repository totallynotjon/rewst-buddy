import { SessionManager } from '@client';
import { log } from '@log';
import GenericCommand from '../GenericCommand';

export class NewSession extends GenericCommand {
	commandName = 'NewSession';

	async execute(...args: unknown[]): Promise<void> {
		const session = await SessionManager.createSession();
		if (await session.validate()) {
			log.notifyInfo(`Created new session for '${session.profile.label}'`);
			await SessionManager.init();
		}
	}
}
