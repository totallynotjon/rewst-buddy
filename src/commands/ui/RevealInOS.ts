import { parseArgsUri } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class RevealInOS extends GenericCommand {
	commandName = 'RevealInOS';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);
		await vscode.commands.executeCommand('revealFileInOS', uri);
	}
}
