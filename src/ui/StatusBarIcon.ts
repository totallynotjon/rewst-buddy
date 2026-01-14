import { extPrefix } from '@global';
import { LinkManager, SyncOnSaveManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';

export class StatusBar implements vscode.Disposable {
	private item: vscode.StatusBarItem;
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.item.show();

		this.disposables.push(
			SessionManager.onSessionChange(() => this.update()),
			LinkManager.onLinksSaved(() => this.update()),
			vscode.window.onDidChangeActiveTextEditor(() => this.update()),
			SyncOnSaveManager.onSyncOnSave(() => this.update()),
		);

		// Initial update
		this.update();
	}

	dispose(): void {
		this.item.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	async update(): Promise<void> {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor === undefined) {
			this.clear();
			return;
		}

		let link;
		try {
			link = LinkManager.getTemplateLink(activeEditor.document.uri);
		} catch {
			this.clear();
			log.error('We failed to get the link of the active document for some reason.');
			return;
		}
		this.item.text = 'Rewst Buddy: Linked';
		this.item.tooltip = this.buildTooltip(link);

		if (!SessionManager.hasActiveSessions()) {
			this.privateWarnNoSession();
			return;
		}

		// Check if we have a session for this template's organization
		try {
			SessionManager.getSessionForOrg(link.org.id);
		} catch (e) {
			log.error(`No session found with access to org ${link.template.organization.name}`);
			this.privateWarnNoSession();
			return;
		}

		const isSyncEnabled = SyncOnSaveManager.isUriSynced(activeEditor.document.uri);

		if (isSyncEnabled) {
			this.privateSyncOnSaveEnabled();
		} else {
			this.privateWarnSyncOnSaveDisabled();
		}
	}

	private privateWarnSyncOnSaveDisabled() {
		this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		this.item.text = 'Rewst Sync-On-Save: OFF $(warning)'; // built-in warning icon
		this.item.command = `${extPrefix}.prefix.EnableSyncOnSave`;
		this.item.show();
	}

	private privateSyncOnSaveEnabled() {
		this.item.backgroundColor = undefined;
		this.item.text = 'Rewst Sync-On-Save: ON $(check)'; // built-in warning icon
		this.item.command = `${extPrefix}.prefix.DisableSyncOnSave`;
		this.item.show();
	}

	private privateWarnNoSession() {
		this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		this.item.text = '$(error) Rewst-Buddy: No Active Session'; // built-in warning icon
		this.item.command = `${extPrefix}.FocusSidebar`;
		this.item.show();
	}

	private buildTooltip(link: TemplateLink): vscode.MarkdownString {
		const { template } = link;

		const lines: string[] = [`## ${template.name}`];

		if (template.description) {
			lines.push('', template.description);
		}

		lines.push('', '---', '', `**Organization:** ${template.organization.name}`);

		const md = new vscode.MarkdownString(lines.join('\n'));
		md.isTrusted = true;
		return md;
	}

	private clear(): void {
		this.item.hide();
		this.item.text = '';
		this.item.tooltip = '';
	}
}
