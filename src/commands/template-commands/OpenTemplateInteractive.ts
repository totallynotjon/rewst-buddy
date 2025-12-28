import { updateButtonVisibility } from '@buttons';
import { log } from '@log';
import { TemplateLinkManager } from '@models';
import { pickTemplate } from '@ui';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenTemplateInteractive extends GenericCommand {
	commandName = 'OpenTemplateInteractive';

	async execute(...args: unknown[]): Promise<void> {
		const pick = await pickTemplate();
		if (!pick) return;

		const session = pick.session;
		const template = pick.template;

		const response = await session.sdk?.getTemplate({ id: template.id });
		if (response?.template === undefined || response?.template === null) {
			throw log.error(`Could not find template with id '${template.id}' under organization '${pick.org.name}'`);
		}

		const content = response.template?.body ?? '';

		const suggestedName = response.template?.name ?? template.name ?? template.id;
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
