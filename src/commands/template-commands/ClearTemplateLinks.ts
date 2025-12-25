import { log } from '@log';
import { updateButtonVisibility } from '@buttons';
import { TemplateLinkManager } from '@models';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class ClearTemplateLinks extends GenericCommand {
	commandName = 'ClearTemplateLinks';

	async execute(...args: unknown[]): Promise<void> {
		const choice = await vscode.window.showInformationMessage(
			'WARNING: This will clear all associations between files and rewst templates/organizations? Are you sure you want to clear this data?',
			{ modal: true },
			'Clear Links',
		);

		switch (choice) {
			case 'Clear Links':
				await TemplateLinkManager.clearTemplateLinks();
				log.notifyInfo('Cleared Template Links');
				updateButtonVisibility();
				break;
		}
	}
}
