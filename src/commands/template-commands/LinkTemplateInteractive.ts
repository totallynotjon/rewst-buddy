import { updateButtonVisibility } from '@buttons';
import { log } from '@log';
import { TemplateLinkManager } from '@models';
import { pickTemplate } from '@ui';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class LinkTemplateInteractive extends GenericCommand {
	commandName = 'LinkTemplateInteractive';

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


		const templatePick = await pickTemplate();
		if (!templatePick) return;
		const session = templatePick.session;
		const org = templatePick.org;

		const response = await session.sdk?.getTemplate({ id: templatePick.template.id });
		if (response?.template === undefined || response?.template === null) {
			throw log.error(`Failed to load the template for linking ${templatePick.template.name}`);
		}

		const template = response.template;
		template.body = editor.document.getText();
		template.updatedAt = '0';

		await TemplateLinkManager.addLink({
			sessionProfile: session.profile,
			template: template,
			uriString: editor.document.uri.toString(),
		}).save();

		await updateButtonVisibility();

		log.notifyInfo('SUCCESS: Linked template');
	}
}
