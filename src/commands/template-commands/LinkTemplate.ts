import { SessionManager } from '@client';
import { log } from '@log';
import { getTemplateURLParams, SimpleTemplate, TemplateLinkManager } from '@models';
import { updateButtonVisibility } from '@buttons';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class LinkTemplate extends GenericCommand {
	commandName = 'LinkTemplate';

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
				log.error('Must save document to disk before linking');
				return;
			}
		}

		const link = TemplateLinkManager.getLink(editor.document.uri);
		if (link !== undefined) {
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

		const template = SimpleTemplate(response.template);
		template.body = editor.document.getText();
		template.updatedAt = '0';

		TemplateLinkManager.saveLink({
			sessionProfile: session.profile,
			template: template,
			uriString: editor.document.uri.toString(),
		});

		await updateButtonVisibility();

		log.notifyInfo('SUCCESS: Linked template');
	}
}
