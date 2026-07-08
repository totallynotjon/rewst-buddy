import { extPrefix } from '@global';
import { WorkingScopeManager } from '@models';
import vscode from 'vscode';

/**
 * Bottom-left status item showing the current working scope (see
 * WorkingScopeManager). It is always visible so the user can see — and change —
 * what Rewst tools are allowed to operate on. Clicking runs Set Working Scope.
 */
export class WorkingScopeStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly disposables: vscode.Disposable[] = [];

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
		this.item.command = `${extPrefix}.SetWorkingScope`;
		this.disposables.push(WorkingScopeManager.onDidChangeScope(() => this.update()));
		this.update();
		this.item.show();
	}

	private update(): void {
		const orgs = WorkingScopeManager.getOrgs();
		const workflows = WorkingScopeManager.getWorkflows();

		if (orgs.length === 0 && workflows.length === 0) {
			this.item.text = '$(globe) Rewst Scope: unset';
			this.item.backgroundColor = undefined;
			this.item.tooltip = new vscode.MarkdownString(
				'**Rewst working scope: unset**\n\nNo org is pinned, so writes are blocked unless an org is always-allowed, and reads span all orgs. Click to pin the orgs you want to work on.',
			);
			this.item.show();
			return;
		}

		const parts: string[] = [];
		if (orgs.length > 0) parts.push(`${orgs.length} org${orgs.length === 1 ? '' : 's'}`);
		if (workflows.length > 0) parts.push(`${workflows.length} workflow${workflows.length === 1 ? '' : 's'}`);
		this.item.text = `$(lock) Rewst Scope: ${parts.join(', ')}`;
		this.item.backgroundColor = undefined;

		const lines = ['**Rewst working scope**', ''];
		if (orgs.length > 0) lines.push(`Orgs: ${orgs.join(', ')}`);
		if (workflows.length > 0) {
			const wfLabels = workflows.map(id => {
				const name = WorkingScopeManager.workflowNames.get(id);
				return name ? `${name} (${id})` : id;
			});
			lines.push(`Workflows: ${wfLabels.join(', ')}`);
		}
		lines.push('', 'Writes stay within this scope; reads too under strict mode. Click to change it.');
		this.item.tooltip = new vscode.MarkdownString(lines.join('\n'));
		this.item.show();
	}

	dispose(): void {
		this.item.dispose();
		this.disposables.forEach(disposable => disposable.dispose());
	}
}
