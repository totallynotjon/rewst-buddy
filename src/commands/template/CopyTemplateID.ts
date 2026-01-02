import { TemplateLinkManager } from '@models';
import { ensureSavedDocument, log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class CopyTemplateID extends GenericCommand {
	commandName = 'CopyTemplateID';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);
		try {
			const link = TemplateLinkManager.getLink(document.uri);

			const templateId = link.template.id;

			await vscode.env.clipboard.writeText(templateId);

			log.notifyInfo('Template ID Copied to clipboard');
		} catch (e) {
			log.notifyError('Could not copy to clipboard', e);
		}
	}
}
