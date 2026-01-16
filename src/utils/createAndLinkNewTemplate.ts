import { LinkManager, TemplateLink } from '@models';
import { FullTemplateFragment } from '@sessions';
import vscode from 'vscode';
import { getHash } from './getHash';

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

	const templateLink: TemplateLink = {
		type: 'Template',
		template: template,
		bodyHash: getHash(content),
		uriString: resultUri.toString(),
		org: {
			id: template.orgId,
			name: template.organization.name,
		},
	};

	await LinkManager.addLink(templateLink);
	return true;
}
