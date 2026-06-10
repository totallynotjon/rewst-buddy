import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class AskRewstAI extends GenericCommand {
	commandName = 'AskRewstAI';

	async execute(): Promise<void> {
		log.trace('AskRewstAI: opening chat with @rewst');
		await vscode.commands.executeCommand('workbench.action.chat.open', '@rewst ');
	}
}
