import { log } from '@log';
import { Server } from '@server';
import GenericCommand from '../GenericCommand';

export class StartServer extends GenericCommand {
	commandName = 'StartServer';

	async execute(): Promise<void> {
		if (Server.getStatus()) {
			log.notifyInfo('Server is already running');
			return;
		}

		const started = await Server.start();
		if (started) {
			log.notifyInfo('Server started');
		}
	}
}
