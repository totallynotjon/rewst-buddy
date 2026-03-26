import { parseArgsUri } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class CopyRelativePath extends GenericCommand {
	commandName = 'CopyRelativePath';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);
		const relativePath = vscode.workspace.asRelativePath(uri);
		await vscode.env.clipboard.writeText(relativePath);
	}
}
