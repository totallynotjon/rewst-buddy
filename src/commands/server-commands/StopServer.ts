import { log } from '@log';
import { Server } from '@server';
import GenericCommand from '../GenericCommand';

export class StopServer extends GenericCommand {
	commandName = 'StopServer';

	async execute(): Promise<void> {
		if (!Server.getStatus()) {
			log.notifyInfo('Server is not running');
			return;
		}

		await Server.stop();
		log.notifyInfo('Server stopped');
	}
}
