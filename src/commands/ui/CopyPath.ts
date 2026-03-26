import { parseArgsUri } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class CopyPath extends GenericCommand {
	commandName = 'CopyPath';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);
		await vscode.env.clipboard.writeText(uri.fsPath);
	}
}
