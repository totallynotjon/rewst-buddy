import { SessionManager } from '@sessions';
import { createAndLinkNewTemplate, getTemplateURLParams, openTemplateById } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenTemplateFromURL extends GenericCommand {
	commandName = 'OpenTemplateFromURL';

	async execute(): Promise<void> {
		const templateURL = await vscode.window.showInputBox({
			placeHolder: 'https://:base_url/:org_id/templates/:template_id',
			prompt: 'Enter the template url to open',
		});

		const params = await getTemplateURLParams(templateURL);

		if (await openTemplateById(params.templateId)) {
			return;
		}

		const session = await SessionManager.getOrgSession(params.orgId, params.baseURL);
		const template = await session.getTemplate(params.templateId);
		await createAndLinkNewTemplate(template);
	}
}
