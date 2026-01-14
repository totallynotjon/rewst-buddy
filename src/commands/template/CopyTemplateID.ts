import { LinkManager } from '@models';
import { ensureSavedDocument, log, parseArgsUri } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class CopyTemplateID extends GenericCommand {
	commandName = 'CopyTemplateID';

	async execute(...args: any[]): Promise<void> {
		let uri = undefined;
		try {
			uri = parseArgsUri(args);
		} catch (e) {
			//no parsed uri, continue
		}

		if (!uri) {
			const document = await ensureSavedDocument(args);
			uri = document.uri;
		}

		try {
			const link = LinkManager.getTemplateLink(uri);

			const templateId = link.template.id;

			await vscode.env.clipboard.writeText(templateId);

			log.notifyInfo('Template ID Copied to clipboard');
		} catch (e) {
			log.notifyError('Could not copy to clipboard', e);
		}
	}
}
