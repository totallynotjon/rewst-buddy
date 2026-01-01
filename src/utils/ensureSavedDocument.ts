import vscode from 'vscode';
import { log } from './log';

export async function getDocumentFromArgs(args: any[]): Promise<vscode.TextDocument> {
	let document: vscode.TextDocument;

	if (args[0][0] instanceof vscode.Uri) {
		document = await vscode.workspace.openTextDocument(args[0][0]);
	} else {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			throw log.error('No active editor');
		}
		document = editor.document;
	}

	return document;
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
