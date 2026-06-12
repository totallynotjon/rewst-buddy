import { extractCodeBlocks, getLastAiAnswer, ProposedContentProvider } from '@ui';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export interface ApplyRewstAiEditArgs {
	uri: string;
	content: string;
}

/** Seams for unit testing the preview-before-write guarantee. */
export interface ApplyEditDeps {
	showDiff(target: vscode.Uri, proposed: vscode.Uri, title: string): Thenable<unknown>;
	/** Shows the modal confirmation; returns true to apply. */
	confirm(fileName: string): Promise<boolean>;
	applyEdit(target: vscode.Uri, content: string): Promise<boolean>;
}

const defaultApplyDeps: ApplyEditDeps = {
	showDiff: (target, proposed, title) => vscode.commands.executeCommand('vscode.diff', target, proposed, title),
	confirm: async fileName => {
		const choice = await vscode.window.showInformationMessage(
			`Apply Cage-Free Rewsty's suggestion to ${fileName}?`,
			{ modal: true },
			'Apply',
		);
		return choice === 'Apply';
	},
	applyEdit: async (target, content) => {
		const document = await vscode.workspace.openTextDocument(target);
		const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
		const edit = new vscode.WorkspaceEdit();
		edit.replace(target, fullRange, content);
		return vscode.workspace.applyEdit(edit);
	},
};

/**
 * The canonical preview-before-write apply path: the diff and the user's
 * confirmation always precede the edit; declining never writes. The edit is
 * applied without saving so the user can review (and sync-on-save only fires
 * once they actually save).
 */
export async function applyWithPreview(
	target: vscode.Uri,
	content: string,
	deps: ApplyEditDeps = defaultApplyDeps,
): Promise<boolean> {
	const fileName = target.path.split('/').pop() ?? target.path;
	const proposed = ProposedContentProvider.put(target, content);
	try {
		await deps.showDiff(target, proposed, `${fileName}: current ↔ Cage-Free Rewsty suggestion`);
		if (!(await deps.confirm(fileName))) {
			log.trace('applyWithPreview: user declined');
			return false;
		}
		if (!(await deps.applyEdit(target, content))) {
			throw log.notifyError(`ApplyRewstAiEdit: could not apply edit to ${fileName}`);
		}
		return true;
	} finally {
		ProposedContentProvider.remove(proposed);
	}
}

/**
 * Applies a RoboRewsty code suggestion to a file behind a diff preview.
 * With explicit args (uri + content) it applies that content; invoked bare
 * from the command palette it offers the code blocks of the most recent
 * RoboRewsty answer against the active editor's file.
 */
export class ApplyRewstAiEdit extends GenericCommand {
	commandName = 'ApplyRewstAiEdit';

	async execute(...args: unknown[]): Promise<void> {
		const payload = (args[0] as unknown[])?.[0] as ApplyRewstAiEditArgs | undefined;
		const resolved =
			typeof payload?.uri === 'string' && typeof payload?.content === 'string'
				? { target: vscode.Uri.parse(payload.uri), content: payload.content }
				: await this.resolveInteractive();
		if (!resolved) return;

		const applied = await applyWithPreview(resolved.target, resolved.content);
		await this.closeDiffTabs(resolved.target);
		if (!applied) return;

		const document = await vscode.workspace.openTextDocument(resolved.target);
		await vscode.window.showTextDocument(document, { preview: false });
		const fileName = resolved.target.path.split('/').pop() ?? resolved.target.path;
		log.notifyInfo(`Applied Cage-Free Rewsty's suggestion to ${fileName} — review and save to persist`);
	}

	/** Palette invocation: active file + a code block from the last answer. */
	private async resolveInteractive(): Promise<{ target: vscode.Uri; content: string } | undefined> {
		const target = vscode.window.activeTextEditor?.document.uri;
		if (!target || target.scheme !== 'file') {
			log.notifyError('Open the file you want to apply the suggestion to first.');
			return undefined;
		}

		const blocks = extractCodeBlocks(getLastAiAnswer() ?? '');
		if (blocks.length === 0) {
			log.notifyError('No code blocks found in the most recent Cage-Free Rewsty answer.');
			return undefined;
		}
		if (blocks.length === 1) return { target, content: blocks[0].content };

		const pick = await vscode.window.showQuickPick(
			blocks.map((block, index) => ({
				label: `Block ${index + 1}${block.language ? ` (${block.language})` : ''}`,
				detail: block.content.split('\n')[0]?.slice(0, 80),
				content: block.content,
			})),
			{ placeHolder: 'Which code block should be applied?' },
		);
		return pick ? { target, content: pick.content } : undefined;
	}

	private async closeDiffTabs(target: vscode.Uri): Promise<void> {
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				if (
					tab.input instanceof vscode.TabInputTextDiff &&
					tab.input.original.toString() === target.toString()
				) {
					await vscode.window.tabGroups.close(tab).then(undefined, () => {});
				}
			}
		}
	}
}
