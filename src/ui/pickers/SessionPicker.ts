import { Session, SessionManager } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';

export async function pickSession(): Promise<Session | undefined> {
	const sessions = await SessionManager.getActiveSessions();

	if (sessions.length === 0) {
		log.notifyWarn('No sessions available. Add a session first.');
		return undefined;
	}

	if (sessions.length === 1) {
		log.debug(`Only one active session, returning it for ease`);
		return sessions[0];
	}

	const items = sessions.map(session => ({
		label: session.profile.label,
		description: session.profile.org.id,
		session,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a session',
	});

	return picked?.session;
}
