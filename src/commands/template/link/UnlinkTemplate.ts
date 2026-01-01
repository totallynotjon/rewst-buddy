import { TemplateLinkManager } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';

export class UnlinkTemplate extends GenericCommand {
	commandName = 'UnlinkTemplate';

	async execute(...args: any[]): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (editor === undefined) {
			throw log.error('No active editor to update');
		}

		const uri = editor.document.uri;

		if (!TemplateLinkManager.isLinked(uri)) {
			throw log.error(`There is no template link to clear for uri ${uri.toString()}`);
		}

		await TemplateLinkManager.removeLink(uri.toString()).save();
		log.notifyInfo(`SUCCESS: Unlinked template from uri ${uri.toString()}`);
	}
}
