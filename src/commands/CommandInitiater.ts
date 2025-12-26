import { context, extPrefix } from '@global';
import { log } from '@log';
import vscode from 'vscode';
import * as Commands from './exportedCommands';
import GenericCommand, { createCommand } from './GenericCommand';

export default class CommandInitiater {
	static registerCommands() {
		log.debug('Registering commands');

		const types: (new () => GenericCommand)[] = Object.values(Commands);

		types.forEach(type => {
			const cmd = createCommand(type);
			const name = `${extPrefix}.${cmd.commandName}`;
			log.debug(`Registering command: ${name}`);
			context.subscriptions.push(
				vscode.commands.registerCommand(name, async (...args: any[]) => {
					log.trace(`Executing command ${cmd.commandName} with args:`, args);
					return await cmd.execute(args);
				}),
			);
		});
	}
}
