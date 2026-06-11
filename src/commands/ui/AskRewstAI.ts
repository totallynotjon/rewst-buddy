import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class AskRewstAI extends GenericCommand {
	commandName = 'AskRewstAI';

	async execute(): Promise<void> {
		log.trace('AskRewstAI: opening the chat view');
		// RoboRewsty is a model in the picker now (not a participant), so just
		// open chat; the user's model choice persists across sessions.
		await vscode.commands.executeCommand('workbench.action.chat.open');
	}
}
