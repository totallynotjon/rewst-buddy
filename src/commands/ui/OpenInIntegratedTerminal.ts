import { parseArgsUri } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenInIntegratedTerminal extends GenericCommand {
	commandName = 'OpenInIntegratedTerminal';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);
		await vscode.commands.executeCommand('openInIntegratedTerminal', uri);
	}
}
