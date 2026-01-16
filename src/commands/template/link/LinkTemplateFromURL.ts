import { LinkManager, SyncManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { ensureSavedDocument, getHash, getTemplateURLParams, log, requireUnlinked } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';

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

		log.trace('LinkTemplateFromURL: fetching template');
		const template = await session.getTemplate(params.templateId);
		template.updatedAt = '0';
		template.body = '';

		const templateLink: TemplateLink = {
			type: 'Template',
			template: template,
			bodyHash: getHash(document.getText()),
			uriString: document.uri.toString(),
			org: {
				id: template.orgId,
				name: template.organization.name,
			},
		};

		log.trace('LinkTemplateFromURL: adding link and syncing');
		await LinkManager.addLink(templateLink);
		await SyncManager.syncTemplate(document);

		log.notifyInfo('SUCCESS: Linked template');
	}
}
