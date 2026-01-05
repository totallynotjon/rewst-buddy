import vscode from 'vscode';

/**
 * Write text content to a file at the given URI.
 * Handles encoding using TextEncoder for UTF-8 output.
 */
export async function writeTextFile(uri: vscode.Uri, content: string): Promise<void> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	await vscode.workspace.fs.writeFile(uri, data);
}
