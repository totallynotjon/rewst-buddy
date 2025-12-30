import { SessionManager } from '@client';
import { log } from '@log';
import { getTemplateURLParams, TemplateLinkManager } from '@models';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';

export class LinkTemplateFromURL extends GenericCommand {
	commandName = 'LinkTemplateFromURL';

	async execute(...args: unknown[]): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (editor === undefined) {
			throw log.error('No active editor to link');
		}

		if (editor.document.uri === undefined) {
			throw log.error('Can only link to document that is saved to disk. Active editor has no uri');
		}

		if (editor.document.isUntitled) {
			let workspaceUri: vscode.Uri;
			if (vscode.workspace.workspaceFolders) {
				workspaceUri = vscode.workspace.workspaceFolders[0].uri;
			} else {
				workspaceUri = editor.document.uri;
			}

			const resultUri = await vscode.workspace.saveAs(editor.document.uri);

			if (!resultUri) {
				throw log.error('Must save document to disk before linking');
			}
		}

		if (TemplateLinkManager.isLinked(editor.document.uri)) {
			const link = TemplateLinkManager.getLink(editor.document.uri);
			throw log.notifyError(
				`Active document is already linked to ${link.template.name} in ${link.template.orgId}/${link.sessionProfile.label}`,
			);
		}

		const templateURL = await vscode.window.showInputBox({
			placeHolder: 'https://:base_url/:org_id/templates/:template_id',
			prompt: 'Enter the template url to link',
		});

		const params = await getTemplateURLParams(templateURL);

		const session = await SessionManager.getOrgSession(params.orgId, params.baseURL);

		const response = await session.sdk?.getTemplate({ id: params.templateId });
		if (response?.template === undefined || response?.template === null) {
			throw log.error(
				`Could not find template with id '${params.templateId}' under organization '${params.orgId}'`,
			);
		}

		const template = response.template;
		template.body = editor.document.getText();
		template.updatedAt = '0';

		await TemplateLinkManager.addLink({
			sessionProfile: session.profile,
			template: template,
			uriString: editor.document.uri.toString(),
		}).save();

		log.notifyInfo('SUCCESS: Linked template');
	}
}
