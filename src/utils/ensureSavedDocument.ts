import vscode from 'vscode';
import { log } from './log';
import { parseArgsUri } from './parseArgsUri';

export async function getDocumentFromArgs(args: any[]): Promise<vscode.TextDocument> {
	let uri: vscode.Uri | undefined;
	try {
		uri = parseArgsUri(args);
	} catch {
		// no uri from args, fall through to active editor
	}

	if (uri) {
		return vscode.workspace.openTextDocument(uri);
	}

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		throw log.error('No active editor');
	}
	return editor.document;
}

/**
 * Gets document from command args (context menu URI) or active editor.
 * Forces saveAs() if untitled. Returns the saved document.
 */
export async function ensureSavedDocument(args: any[]): Promise<vscode.TextDocument> {
	let document = await getDocumentFromArgs(args);

	if (document.isUntitled) {
		const resultUri = await vscode.workspace.saveAs(document.uri);
		if (!resultUri) {
			throw log.error('Must save document to disk before proceeding');
		}
		document = await vscode.workspace.openTextDocument(resultUri);
	}

	return document;
}
