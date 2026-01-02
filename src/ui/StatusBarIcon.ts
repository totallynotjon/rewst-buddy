import { extPrefix } from '@global';
import { SyncOnSaveManager, TemplateLink, TemplateLinkManager } from '@models';
import RewstSession, { SessionManager } from '@sessions';
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
			TemplateLinkManager.onLinksSaved(() => this.update()),
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

		const isLinked = TemplateLinkManager.isLinked(activeEditor.document.uri);

		let link;
		try {
			link = TemplateLinkManager.getLink(activeEditor.document.uri);
		} catch {
			this.clear();
			log.error('We failed to get the link of the active document for some reason.');
			return;
		}
		this.item.text = 'Rewst Buddy: Linked';
		this.item.backgroundColor = undefined;
		this.item.tooltip = this.buildTooltip(link);

		let session: RewstSession;
		try {
			session = SessionManager.getSessionForOrg(link.template.orgId);
		} catch (e) {
			log.error(`No session found with access to org ${link.template.organization.name}`);
			this.privateWarnNoSession();
			return;
		}

		const isSyncEnabled = SyncOnSaveManager.isUriSynced(activeEditor.document.uri);

		if (!isSyncEnabled) {
			this.privateWarnSyncOnSaveDisabled();
		} else {
			this.privateSyncOnSaveEnabled();
		}
	}

	private privateWarnSyncOnSaveDisabled() {
		this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		this.item.text = 'Rewst Sync-On-Save: OFF $(warning)'; // built-in warning icon
		this.item.command = `${extPrefix}.prefix.RemoveSyncExclusion`;
		this.item.show();
	}

	private privateSyncOnSaveEnabled() {
		this.item.backgroundColor = undefined;
		this.item.text = 'Rewst Sync-On-Save: ON $(check)'; // built-in warning icon
		this.item.command = `${extPrefix}.prefix.AddSyncExclusion`;
		this.item.show();
	}

	private privateWarnNoSession() {
		this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		this.item.text = '$(error) Rewst-Buddy: No Active Session'; // built-in warning icon
		this.item.command = `${extPrefix}.FocusSidebar`;
		this.item.show();
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
		this.item.hide();
		this.item.text = '';
		this.item.tooltip = '';
	}
}
