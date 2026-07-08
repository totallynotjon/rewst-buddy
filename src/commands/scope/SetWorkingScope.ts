import { WorkingScopeManager } from '@models';
import { SessionManager } from '@sessions';
import { log } from '@utils';
import vscode, { QuickPickItem } from 'vscode';
import GenericCommand from '../GenericCommand';

interface OrgPickItem extends QuickPickItem {
	id: string;
}

interface WorkflowPickItem extends QuickPickItem {
	id: string;
}

/**
 * Sets the working scope's orgs from a multi-select of every managed org. The
 * working scope is the ambient blast-radius cap: writes (and, under strict scope,
 * reads) are limited to the selected orgs. Selecting none clears the org scope.
 */
export class SetWorkingScope extends GenericCommand {
	commandName = 'SetWorkingScope';

	async execute(): Promise<void> {
		const sessions = SessionManager.getActiveSessions();
		if (sessions.length === 0) {
			log.notifyError('No active Rewst sessions. Start a session before setting the working scope.');
			return;
		}

		const orgNames = new Map<string, string>();
		for (const session of sessions) {
			const { org, allManagedOrgs } = session.profile;
			if (org?.id) orgNames.set(org.id, org.name ?? org.id);
			for (const managed of allManagedOrgs ?? []) {
				if (managed?.id) orgNames.set(managed.id, managed.name ?? managed.id);
			}
		}

		const pinned = new Set(WorkingScopeManager.getOrgs());
		const byLabel = (a: OrgPickItem, b: OrgPickItem) => a.label.localeCompare(b.label);
		const orgItems = [...orgNames].map(([id, name]) => ({
			id,
			label: name,
			description: id,
			picked: pinned.has(id),
		}));
		const inScope = orgItems.filter(item => item.picked).sort(byLabel);
		const others = orgItems.filter(item => !item.picked).sort(byLabel);

		// Show the orgs already in scope first, grouped under a separator, so the
		// current selection is obvious instead of scattered through the list.
		const items: (OrgPickItem | vscode.QuickPickItem)[] = [];
		if (inScope.length > 0) {
			items.push({ label: 'In scope', kind: vscode.QuickPickItemKind.Separator }, ...inScope);
			items.push({ label: 'Other organizations', kind: vscode.QuickPickItemKind.Separator });
		}
		items.push(...others);

		const picked = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: 'Select the orgs to work on — writes (and reads, in strict mode) are limited to these',
		});
		if (picked === undefined) return; // cancelled

		const selectedOrgIds = picked
			.map(item => (item as OrgPickItem).id)
			.filter((id): id is string => typeof id === 'string');

		// Second quick-pick: let the user adjust pinned workflows (if any are pinned).
		// Show workflow names when available, falling back to the raw id.
		const pinnedWorkflowIds = WorkingScopeManager.getWorkflows();
		let selectedWorkflowIds: string[] = pinnedWorkflowIds;
		if (pinnedWorkflowIds.length > 0) {
			const workflowItems: WorkflowPickItem[] = pinnedWorkflowIds.map(id => {
				const name = WorkingScopeManager.workflowNames.get(id);
				return {
					id,
					label: name ?? id,
					description: name ? id : undefined,
					picked: true,
				};
			});
			const pickedWorkflows = await vscode.window.showQuickPick(workflowItems, {
				canPickMany: true,
				placeHolder: 'Select the workflows to keep pinned (deselect to remove from scope)',
			});
			if (pickedWorkflows === undefined) return; // cancelled
			selectedWorkflowIds = pickedWorkflows
				.map(item => item.id)
				.filter((id): id is string => typeof id === 'string');
		}

		WorkingScopeManager.applyChange({ orgs: selectedOrgIds, workflows: selectedWorkflowIds, replace: true });
		const orgPart = picked.length > 0 ? `${picked.length} org${picked.length === 1 ? '' : 's'}` : 'no orgs';
		const wfPart =
			selectedWorkflowIds.length > 0
				? ` and ${selectedWorkflowIds.length} workflow${selectedWorkflowIds.length === 1 ? '' : 's'}`
				: '';
		log.notifyInfo(
			picked.length > 0 || selectedWorkflowIds.length > 0
				? `Working scope set to ${orgPart}${wfPart}.`
				: 'Working scope cleared.',
		);
	}
}
