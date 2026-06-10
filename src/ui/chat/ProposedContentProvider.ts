import vscode from 'vscode';

export const PROPOSED_SCHEME = 'rewst-ai-proposed';

/**
 * Read-only virtual documents holding RoboRewsty's proposed file content, so
 * the apply flow can show a native diff (current file ↔ suggestion) before
 * any edit is made. Keeps the target's filename for syntax highlighting.
 */
export const ProposedContentProvider = new (class ProposedContentProvider
	implements vscode.TextDocumentContentProvider, vscode.Disposable
{
	private contents = new Map<string, string>();
	private registration: vscode.Disposable | undefined;
	private counter = 0;

	init(): this {
		this.registration = vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, this);
		return this;
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '';
	}

	put(target: vscode.Uri, content: string): vscode.Uri {
		const proposed = target.with({ scheme: PROPOSED_SCHEME, query: `proposal=${++this.counter}` });
		this.contents.set(proposed.toString(), content);
		return proposed;
	}

	remove(proposed: vscode.Uri): void {
		this.contents.delete(proposed.toString());
	}

	dispose(): void {
		this.registration?.dispose();
		this.registration = undefined;
		this.contents.clear();
	}
})();
