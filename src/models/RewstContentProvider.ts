import vscode from 'vscode';

export const REWST_REMOTE_SCHEME = 'rewst-remote';

/**
 * Read-only virtual documents holding a Rewst template's remote body, so the
 * conflict/diff flow can show a native diff (local file ↔ remote) without any
 * local or remote state changing. Keeps the target's filename for syntax
 * highlighting. Callers fetch first and call `put()`; this provider never
 * does I/O itself.
 */
export const RewstContentProvider = new (class RewstContentProvider
	implements vscode.TextDocumentContentProvider, vscode.Disposable
{
	private contents = new Map<string, string>();
	private registration: vscode.Disposable | undefined;
	private closeListener: vscode.Disposable | undefined;
	private counter = 0;

	init(): this {
		this.registration = vscode.workspace.registerTextDocumentContentProvider(REWST_REMOTE_SCHEME, this);
		this.closeListener = vscode.workspace.onDidCloseTextDocument(doc => {
			if (doc.uri.scheme === REWST_REMOTE_SCHEME) this.remove(doc.uri);
		});
		return this;
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '';
	}

	put(target: vscode.Uri, content: string): vscode.Uri {
		const remote = target.with({ scheme: REWST_REMOTE_SCHEME, query: `rewst-remote=${++this.counter}` });
		this.contents.set(remote.toString(), content);
		return remote;
	}

	remove(remote: vscode.Uri): void {
		this.contents.delete(remote.toString());
	}

	dispose(): void {
		this.registration?.dispose();
		this.registration = undefined;
		this.closeListener?.dispose();
		this.closeListener = undefined;
		this.contents.clear();
	}

	_resetForTesting(): void {
		this.contents.clear();
		this.counter = 0;
	}
})();

/**
 * Inserts a "(Rewst)" marker before the extension so the remote side of a diff
 * reads differently from the local file at a glance — VS Code's diff editor
 * labels each pane from its resource path, and `put()` otherwise preserves the
 * local path exactly, leaving both sides looking identical except for the
 * easy-to-miss tab title.
 */
function labelRemotePath(path: string): string {
	const lastSlash = path.lastIndexOf('/');
	const dir = path.slice(0, lastSlash + 1);
	const base = path.slice(lastSlash + 1);
	const dotIndex = base.lastIndexOf('.');
	return dotIndex <= 0 ? `${dir}${base} (Rewst)` : `${dir}${base.slice(0, dotIndex)} (Rewst)${base.slice(dotIndex)}`;
}

/**
 * Opens a native diff between a linked document and a remote template body,
 * via a `rewst-remote:` virtual document. Shared by conflict resolution and
 * "Diff Against Rewst" so both open the same diff the same way.
 */
export async function showRewstDiff(
	doc: vscode.TextDocument,
	remoteBody: string,
	subtitle: string,
): Promise<vscode.Uri> {
	const remoteTarget = doc.uri.with({ path: labelRemotePath(doc.uri.path) });
	const remoteUri = RewstContentProvider.put(remoteTarget, remoteBody);
	const fileName = doc.uri.path.split('/').pop() ?? doc.uri.path;
	await vscode.commands.executeCommand('vscode.diff', doc.uri, remoteUri, `${fileName}: ${subtitle}`);
	return remoteUri;
}
