import { log } from '@utils';
import { TemplateLinkManager } from '@models';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';

export class UnlinkAllTemplates extends GenericCommand {
	commandName = 'UnlinkAllTemplates';

	async execute(...args: unknown[]): Promise<void> {
		const choice = await vscode.window.showInformationMessage(
			'WARNING: This will clear all associations between files and rewst templates/organizations? Are you sure you want to clear this data?',
			{ modal: true },
			'Clear Links',
		);

		switch (choice) {
			case 'Clear Links':
				await TemplateLinkManager.clearTemplateLinks().save();
				log.notifyInfo('Cleared Template Links');
				break;
		}
	}
}
