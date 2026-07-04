import { SessionManager } from '@sessions';
import { ensureSavedDocument, getTemplateURLParams, log, requireUnlinked } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';
import { linkDocumentToTemplate } from './linkDocumentToTemplate';

export class LinkTemplateFromURL extends GenericCommand {
	commandName = 'LinkTemplateFromURL';

	async execute(...args: unknown[]): Promise<void> {
		log.trace('LinkTemplateFromURL: starting');

		const document = await ensureSavedDocument(args);
		requireUnlinked(document.uri);

		const templateURL = await vscode.window.showInputBox({
			placeHolder: 'https://:base_url/:org_id/templates/:template_id',
			prompt: 'Enter the template url to link',
		});

		const params = await getTemplateURLParams(templateURL);
		log.debug('LinkTemplateFromURL: parsed URL', { orgId: params.orgId, templateId: params.templateId });

		const session = await SessionManager.getOrgSession(params.orgId, params.baseURL);

		await linkDocumentToTemplate(document, session, params.templateId, 'LinkTemplateFromURL');
	}
}
