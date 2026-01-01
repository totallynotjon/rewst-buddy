import { log } from '@utils';
import { TemplateLink, TemplateLinkManager } from '@models';
import vscode from 'vscode';

export class StatusBar implements vscode.Disposable {
	private item: vscode.StatusBarItem;
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.item.show();

		this.disposables.push(
			TemplateLinkManager.onLinksSaved(() => this.update()),
			vscode.window.onDidChangeActiveTextEditor(() => this.update()),
		);

		// Initial update
		this.update();
	}

	dispose(): void {
		this.item.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	update(editor?: vscode.TextEditor): void {
		const activeEditor = editor ?? vscode.window.activeTextEditor;
		if (activeEditor === undefined) {
			this.clear();
			return;
		}

		const isLinked = TemplateLinkManager.isLinked(activeEditor.document.uri);

		if (!isLinked) {
			this.clear();
			return;
		}

		this.item.text = 'Rewst Buddy: $(check) Linked';

		let link;
		try {
			link = TemplateLinkManager.getLink(activeEditor.document.uri);
		} catch {
			log.error('We failed to get the link of the active document for some reason.');
			return;
		}

		this.item.tooltip = this.buildTooltip(link);
	}

	private buildTooltip(link: TemplateLink): vscode.MarkdownString {
		const { template, sessionProfile } = link;

		const lines: string[] = [`## ${template.name}`];

		if (template.description) {
			lines.push('', template.description);
		}

		lines.push('', '---', '', `**Organization:** ${template.organization.name}`);

		lines.push('', '---', '', `**Session:** ${sessionProfile.label}`, `**Region:** ${sessionProfile.region.name}`);

		const md = new vscode.MarkdownString(lines.join('\n'));
		md.isTrusted = true;
		return md;
	}

	private clear(): void {
		this.item.text = 'Rewst Buddy: $(circle-large-outline) Unlinked';
		this.item.tooltip = '';
	}
}
