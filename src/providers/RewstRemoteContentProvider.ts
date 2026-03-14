import vscode from 'vscode';

export const REWST_REMOTE_SCHEME = 'rewst-remote';

/**
 * Provides in-memory content for remote Rewst templates.
 * Used to display remote template content as a readonly virtual document
 * in the diff editor when previewing local changes before uploading.
 */
export class RewstRemoteContentProvider implements vscode.TextDocumentContentProvider {
	private readonly contents = new Map<string, string>();

	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.onDidChangeEmitter.event;

	set(uri: vscode.Uri, content: string): void {
		this.contents.set(uri.toString(), content);
		this.onDidChangeEmitter.fire(uri);
	}

	delete(uri: vscode.Uri): void {
		this.contents.delete(uri.toString());
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '';
	}

	dispose(): void {
		this.onDidChangeEmitter.dispose();
		this.contents.clear();
	}
}

export const remoteContentProvider = new RewstRemoteContentProvider();
