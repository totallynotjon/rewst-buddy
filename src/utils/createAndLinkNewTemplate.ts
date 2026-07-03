import { buildTemplateLink, LinkManager } from '@models';
import { FullTemplateFragment } from '@sessions';
import vscode from 'vscode';

/**
 * Creates a new untitled document from template content,
 * prompts user to save, and links the file to the template.
 *
 * @returns true if saved and linked, false if user cancelled
 */
export async function createAndLinkNewTemplate(template: FullTemplateFragment): Promise<boolean> {
	const content = template.body;
	template.body = '';

	const untitledUri = vscode.Uri.parse(`untitled:${template.name ?? template.id}`);
	const doc = await vscode.workspace.openTextDocument(untitledUri);
	const editor = await vscode.window.showTextDocument(doc);

	await editor.edit(edit => {
		edit.insert(new vscode.Position(0, 0), content);
	});

	const resultUri = await vscode.workspace.saveAs(editor.document.uri);
	if (!resultUri) {
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		return false;
	}

	const templateLink = buildTemplateLink(template, content, resultUri.toString());

	await LinkManager.addLink(templateLink);
	return true;
}
