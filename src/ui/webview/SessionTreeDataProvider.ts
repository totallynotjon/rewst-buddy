import vscode from 'vscode';
import RewstSession, { SessionManager } from '@client';

export class SessionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly session: RewstSession,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
	) {
		super(session.profile.label, collapsibleState);

		this.description = session.profile.region.name;
		this.tooltip = this.buildTooltip();
		this.iconPath = new vscode.ThemeIcon('account');
		this.contextValue = 'session';
	}

	private buildTooltip(): vscode.MarkdownString {
		const { profile } = this.session;
		const lines = [
			`**${profile.label}**`,
			``,
			`**Organization:** ${profile.org.name}`,
			`**Region:** ${profile.region.name}`,
			`**Managed Orgs:** ${profile.allManagedOrgs.length}`,
		];
		return new vscode.MarkdownString(lines.join('\n'));
	}
}

export class SessionTreeDataProvider implements vscode.TreeDataProvider<SessionTreeItem>, vscode.Disposable {
	private changeEmitter = new vscode.EventEmitter<SessionTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.disposables.push(SessionManager.onSessionChange(() => this.refresh()));
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: SessionTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: SessionTreeItem): Thenable<SessionTreeItem[]> {
		if (element) {
			return Promise.resolve([]);
		}

		const sessions = Array.from(SessionManager.sessionMap.values());
		const items = sessions.map(session => new SessionTreeItem(session, vscode.TreeItemCollapsibleState.None));

		return Promise.resolve(items);
	}
}
