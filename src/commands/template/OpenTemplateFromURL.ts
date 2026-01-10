import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { getTemplateURLParams, openTemplateById } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenTemplateFromURL extends GenericCommand {
	commandName = 'OpenTemplateFromURL';

	async execute(...args: unknown[]): Promise<void> {
		const templateURL = await vscode.window.showInputBox({
			placeHolder: 'https://:base_url/:org_id/templates/:template_id',
			prompt: 'Enter the template url to open',
		});

		const params = await getTemplateURLParams(templateURL);

		// if we open the template by the id no need to pick further
		if (await openTemplateById(params.templateId)) {
			return;
		}

		const session = await SessionManager.getOrgSession(params.orgId, params.baseURL);

		const template = await session.getTemplate(params.templateId);
		const content = template.body ?? '';

		const untitledUri = vscode.Uri.parse(`untitled:${template.name ?? params.templateId}`);
		const doc = await vscode.workspace.openTextDocument(untitledUri);
		const editor = await vscode.window.showTextDocument(doc);

		await editor.edit(edit => {
			edit.insert(new vscode.Position(0, 0), content);
		});

		const resultUri = await vscode.workspace.saveAs(editor.document.uri);
		if (!resultUri) {
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			return;
		}

		const templateLink: TemplateLink = {
			type: 'Template',
			template: template,
			uriString: resultUri.toString(),
			org: {
				id: template.orgId,
				name: template.organization.name,
			},
		};

		await LinkManager.addLink(templateLink);
	}
}
