import * as vscode from 'vscode';
import GenericCommand, { createCommand, CommandContext } from '@commands/models/GenericCommand.js';
import * as Commands from '@commands/index.js'


export default class CommandInitiater {

    static registerCommands(cmdContext: CommandContext) {
        console.log('registering');

        const types: Array<new (ctx: CommandContext) => GenericCommand> = Object.values(Commands);

        types.forEach(type => {
            const cmd = createCommand(type, cmdContext);
            const name = `${cmdContext.commandPrefix}.${cmd.commandName}`;
            console.log(`Registering command: ${name}`);
            cmdContext.context.subscriptions.push(
                vscode.commands.registerCommand(
                    name,
                    async (...args: any[]) => {
                        console.log(`executing cmd ${cmd.commandName}`);
                        return await cmd.execute(args);
                    }
                )
            );
        });
    }

}