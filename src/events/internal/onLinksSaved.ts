import { extPrefix } from '@global';
import { TemplateLinkManager } from '@models';
import { updateStatusBar } from '@ui';
import vscode from 'vscode';

export async function onLinksSaved() {
	updateLinkedTemplatesContext();
	await updateStatusBar();
}

function updateLinkedTemplatesContext() {
	const links = TemplateLinkManager.getAllUris();
	const pathObject: Record<string, boolean> = {};
	for (const uri of links) {
		pathObject[uri.fsPath] = true;
	}
	vscode.commands.executeCommand('setContext', `${extPrefix}.linkedTemplates`, pathObject);
}
