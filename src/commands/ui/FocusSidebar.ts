import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class FocusSidebar extends GenericCommand {
	commandName = 'FocusSidebar';

	async execute(...args: unknown[]): Promise<void> {
		log.info('Focus Siderbar');
		await vscode.commands.executeCommand(`rewst-buddy.sessionInput.focus`);
	}
}
