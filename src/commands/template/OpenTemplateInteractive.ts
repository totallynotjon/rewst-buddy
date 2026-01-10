import { LinkManager, TemplateLink } from '@models';
import { pickTemplate } from '@ui';
import { openTemplateById } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenTemplateInteractive extends GenericCommand {
	commandName = 'OpenTemplateInteractive';

	async execute(...args: unknown[]): Promise<void> {
		const pick = await pickTemplate();
		if (!pick) return;

		// if we open the template by the id no need to pick further
		if (await openTemplateById(pick.template.id)) {
			return;
		}

		const template = await pick.session.getTemplate(pick.template.id);

		const content = template.body ?? '';

		const untitledUri = vscode.Uri.parse(`untitled:${template.name ?? pick.template.id}`);
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
