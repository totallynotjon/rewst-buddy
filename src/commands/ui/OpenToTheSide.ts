import { parseArgsUri } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenToTheSide extends GenericCommand {
	commandName = 'OpenToTheSide';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);
		await vscode.commands.executeCommand('vscode.open', uri, vscode.ViewColumn.Beside);
	}
}
