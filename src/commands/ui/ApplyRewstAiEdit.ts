import { ProposedContentProvider } from '@ui';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export interface ApplyRewstAiEditArgs {
	uri: string;
	content: string;
}

/**
 * Invoked from a chat response button: shows a diff between the target file
 * and RoboRewsty's suggested content, then applies it after confirmation.
 * The edit is applied without saving so the user can review (and sync-on-save
 * only fires once they actually save).
 */
export class ApplyRewstAiEdit extends GenericCommand {
	commandName = 'ApplyRewstAiEdit';

	async execute(...args: unknown[]): Promise<void> {
		const payload = (args[0] as unknown[])?.[0] as ApplyRewstAiEditArgs | undefined;
		if (typeof payload?.uri !== 'string' || typeof payload?.content !== 'string') {
			throw log.error('ApplyRewstAiEdit: missing target uri or content');
		}

		const target = vscode.Uri.parse(payload.uri);
		const fileName = target.path.split('/').pop() ?? target.path;
		const proposed = ProposedContentProvider.put(target, payload.content);

		try {
			await vscode.commands.executeCommand(
				'vscode.diff',
				target,
				proposed,
				`${fileName}: current ↔ RoboRewsty suggestion`,
			);

			const choice = await vscode.window.showInformationMessage(
				`Apply RoboRewsty's suggestion to ${fileName}?`,
				{ modal: true },
				'Apply',
			);

			await this.closeDiffTabs(proposed);

			if (choice !== 'Apply') {
				log.trace('ApplyRewstAiEdit: user declined');
				return;
			}

			const document = await vscode.workspace.openTextDocument(target);
			const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
			const edit = new vscode.WorkspaceEdit();
			edit.replace(target, fullRange, payload.content);

			if (!(await vscode.workspace.applyEdit(edit))) {
				throw log.notifyError(`ApplyRewstAiEdit: could not apply edit to ${fileName}`);
			}

			await vscode.window.showTextDocument(document, { preview: false });
			log.notifyInfo(`Applied RoboRewsty's suggestion to ${fileName} — review and save to persist`);
		} finally {
			ProposedContentProvider.remove(proposed);
		}
	}

	private async closeDiffTabs(proposed: vscode.Uri): Promise<void> {
		const proposedKey = proposed.toString();
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				if (tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === proposedKey) {
					await vscode.window.tabGroups.close(tab).then(undefined, () => {});
				}
			}
		}
	}
}
