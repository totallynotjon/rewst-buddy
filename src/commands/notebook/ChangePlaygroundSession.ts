import { SessionManager } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class ChangePlaygroundSession extends GenericCommand {
	commandName = 'ChangePlaygroundSession';

	async execute(): Promise<void> {
		const notebook = vscode.window.activeNotebookEditor?.notebook;
		if (!notebook || notebook.notebookType !== 'rewst-playground') {
			log.notifyWarn('No active playground notebook');
			return;
		}

		const sessions = SessionManager.getActiveSessions();
		if (sessions.length === 0) {
			log.notifyWarn('No active sessions. Add a session first.');
			return;
		}

		const items = sessions.map(session => ({
			label: session.profile.label,
			description: session.profile.org.id,
			session,
		}));

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a session for this playground',
		});

		if (!picked) return;

		// Update notebook metadata with new session
		const edit = new vscode.WorkspaceEdit();
		const metadata = {
			...(notebook.metadata ?? {}),
			playgroundSessionOrgId: picked.session.profile.org.id,
		};
		edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(metadata)]);
		await vscode.workspace.applyEdit(edit);

		log.notifyInfo(`Playground session changed to: ${picked.session.profile.label}`);
	}
}
