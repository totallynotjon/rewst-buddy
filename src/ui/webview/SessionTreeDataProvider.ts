import { SessionChangeEvent } from '@events';
import { RewstSessionProfile, SessionManager } from '@sessions';
import vscode from 'vscode';

export class SessionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly profile: RewstSessionProfile,
		public readonly active: boolean,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
	) {
		super(profile.label, collapsibleState);

		this.description = profile.region.name;
		this.tooltip = this.buildTooltip();
		if (this.active) {
			this.iconPath = new vscode.ThemeIcon('check');
		} else {
			this.iconPath = new vscode.ThemeIcon('error');
		}

		this.contextValue = 'session';
	}

	private buildTooltip(): vscode.MarkdownString {
		const lines = [
			`**${this.active ? 'Active' : 'EXPIRED'}: ${this.profile.label}**`,
			``,
			`**Organization:** ${this.profile.org.name}`,
			`**Region:** ${this.profile.region.name}`,
			`**Managed Orgs:** ${this.profile.allManagedOrgs.length}`,
		];
		return new vscode.MarkdownString(lines.join('\n'));
	}
}

export class SessionTreeDataProvider implements vscode.TreeDataProvider<SessionTreeItem>, vscode.Disposable {
	private changeEmitter = new vscode.EventEmitter<SessionTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private disposables: vscode.Disposable[] = [];

	private allKnownProfiles: RewstSessionProfile[] = [];
	private activeProfileUserIDs: string[] = [];

	constructor() {
		this.disposables.push(SessionManager.onSessionChange(e => this.refresh(e)));
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}

	refresh(e?: SessionChangeEvent): void {
		if (e !== undefined) {
			this.activeProfileUserIDs = e.activeProfiles.map(profile => profile.user.id ?? '');
			this.allKnownProfiles = e.allProfiles;
		}

		this.changeEmitter.fire();
	}

	getTreeItem(element: SessionTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: SessionTreeItem): Thenable<SessionTreeItem[]> {
		if (element) {
			return Promise.resolve([]);
		}

		const items = this.allKnownProfiles.map(
			profile =>
				new SessionTreeItem(
					profile,
					this.activeProfileUserIDs.includes(profile.user.id ?? ''),
					vscode.TreeItemCollapsibleState.None,
				),
		);

		return Promise.resolve(items);
	}
}
