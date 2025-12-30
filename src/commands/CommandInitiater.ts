import { context, extPrefix } from '@global';
import { log } from '@utils';
import vscode from 'vscode';
import * as Commands from './exportedCommands';
import GenericCommand, { createCommand } from './GenericCommand';

export default class CommandInitiater {
	static registerCommands() {
		log.debug('Registering commands');

		const types: (new () => GenericCommand)[] = Object.values(Commands);

		types.forEach(type => {
			const cmd = createCommand(type);

			[`${extPrefix}.${cmd.commandName}`, `${extPrefix}.prefix.${cmd.commandName}`].forEach(name => {
				log.trace(name);
				context.subscriptions.push(
					vscode.commands.registerCommand(name, async (...args: any[]) => {
						log.trace(`Executing command ${cmd.commandName} with args:`, args);
						return await cmd.execute(args);
					}),
				);
			});
		});
	}
}
