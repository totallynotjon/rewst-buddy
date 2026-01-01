import { SessionManager } from '@client';
import { TemplateLinkManager } from '@models';
import { ensureSavedDocument, getTemplateURLParams, log, requireUnlinked } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';

export class LinkTemplateFromURL extends GenericCommand {
	commandName = 'LinkTemplateFromURL';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);
		requireUnlinked(document.uri);

		const templateURL = await vscode.window.showInputBox({
			placeHolder: 'https://:base_url/:org_id/templates/:template_id',
			prompt: 'Enter the template url to link',
		});

		const params = await getTemplateURLParams(templateURL);
		const session = await SessionManager.getOrgSession(params.orgId, params.baseURL);

		const template = await session.getTemplate(params.templateId);
		template.body = document.getText();
		template.updatedAt = '0';

		await TemplateLinkManager.addLink({
			sessionProfile: session.profile,
			template: template,
			uriString: document.uri.toString(),
		}).save();

		log.notifyInfo('SUCCESS: Linked template');
	}
}
