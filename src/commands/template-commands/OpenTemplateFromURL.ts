import { updateButtonVisibility } from '@buttons';
import { SessionManager } from '@client';
import { log } from '@log';
import { getTemplateURLParams, TemplateLinkManager } from '@models';
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

		const session = await SessionManager.getOrgSession(params.orgId, params.baseURL);

		const response = await session.sdk?.getTemplate({ id: params.templateId });
		if (response?.template === undefined || response?.template === null) {
			throw log.error(
				`Could not find template with id '${params.templateId}' under organization '${params.orgId}'`,
			);
		}

		const content = response.template?.body ?? '';

		const suggestedName = response.template?.name ?? params.templateId;
		const untitledUri = vscode.Uri.parse(`untitled:${suggestedName}`);

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

		await TemplateLinkManager.addLink({
			sessionProfile: session.profile,
			template: response.template,
			uriString: resultUri.toString(),
		}).save();

		await updateButtonVisibility();
	}
}
