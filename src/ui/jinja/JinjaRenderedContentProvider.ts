import vscode from 'vscode';
import { previewBaseName } from './jinjaPreviewRender';

export const JINJA_RENDER_SCHEME = 'rewst-jinja-render';

export const JINJA_RENDER_PLACEHOLDER =
	'// No context selected yet. Use "Pick Jinja Preview Context" on the template\'s tab.';

/**
 * Read-only, live-refreshing virtual documents holding the current Jinja
 * render for a linked template. Unlike RewstContentProvider/ProposedContentProvider
 * (static, single-shot content), the same deterministic uri is reused across a
 * template's whole preview session, and update() re-fires onDidChange so any
 * open editor for that uri refreshes without user action.
 */
export const JinjaRenderedContentProvider = new (class JinjaRenderedContentProvider
	implements vscode.TextDocumentContentProvider, vscode.Disposable
{
	private contents = new Map<string, string>();
	private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
	private registration: vscode.Disposable | undefined;

	readonly onDidChange = this.emitter.event;

	init(): this {
		this.registration = vscode.workspace.registerTextDocumentContentProvider(JINJA_RENDER_SCHEME, this);
		return this;
	}

	uriFor(templateId: string, templateName: string): vscode.Uri {
		return vscode.Uri.from({
			scheme: JINJA_RENDER_SCHEME,
			path: `/${previewBaseName(templateId, templateName)}.rendered.jsonc`,
		});
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? JINJA_RENDER_PLACEHOLDER;
	}

	update(uri: vscode.Uri, content: string): void {
		this.contents.set(uri.toString(), content);
		this.emitter.fire(uri);
	}

	clear(uri: vscode.Uri): void {
		this.contents.delete(uri.toString());
	}

	dispose(): void {
		this.registration?.dispose();
		this.registration = undefined;
		this.contents.clear();
	}

	_resetForTesting(): void {
		this.contents.clear();
	}
})();
