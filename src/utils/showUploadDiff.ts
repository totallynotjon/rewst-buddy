import vscode from 'vscode';
import { REWST_REMOTE_SCHEME, remoteContentProvider } from '../providers/RewstRemoteContentProvider';

/**
 * Opens a diff editor showing the current Rewst remote content (left/readonly)
 * vs the local file (right), then asks the user to confirm or cancel the upload.
 *
 * Only used for manual syncs — sync-on-save skips this step.
 *
 * @returns true if the user confirmed the upload, false if they cancelled
 */
export async function showUploadDiff(
	localDoc: vscode.TextDocument,
	remoteBody: string,
	templateName: string,
	templateId: string,
): Promise<boolean> {
	const remoteUri = vscode.Uri.parse(`${REWST_REMOTE_SCHEME}://templates/${templateId}`);
	remoteContentProvider.set(remoteUri, remoteBody);

	try {
		await vscode.commands.executeCommand(
			'vscode.diff',
			remoteUri,
			localDoc.uri,
			`${templateName}: Rewst (remote) ↔ Local`,
			{ preview: true },
		);

		const choice = await vscode.window.showInformationMessage(
			`Upload your local changes to "${templateName}" in Rewst?`,
			{ modal: false },
			'Upload',
			'Cancel',
		);

		return choice === 'Upload';
	} finally {
		remoteContentProvider.delete(remoteUri);

		// Close the diff tab now that the user has made a decision
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				if (tab.input instanceof vscode.TabInputTextDiff) {
					const input = tab.input as vscode.TabInputTextDiff;
					if (
						input.original.toString() === remoteUri.toString() &&
						input.modified.toString() === localDoc.uri.toString()
					) {
						await vscode.window.tabGroups.close(tab);
					}
				}
			}
		}
	}
}
