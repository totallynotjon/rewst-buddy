import vscode from 'vscode';

/**
 * Check if a file or folder exists at the given URI.
 * Uses VS Code's workspace.fs API for cross-platform compatibility.
 */
export async function uriExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return false;
		}
		throw error;
	}
}
