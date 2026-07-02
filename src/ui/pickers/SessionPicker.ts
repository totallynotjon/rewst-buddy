import { Session, SessionManager, SessionProfile } from '@sessions';
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

/**
 * Picks from every known session profile — active or previously authenticated
 * (known-only) — for operations like removal that must reach an inactive
 * profile too, not just a currently active one.
 */
export async function pickKnownProfile(): Promise<SessionProfile | undefined> {
	const profiles = SessionManager.getAllKnownProfiles();

	if (profiles.length === 0) {
		log.notifyWarn('No sessions available.');
		return undefined;
	}

	if (profiles.length === 1) {
		log.debug(`Only one known session, returning it for ease`);
		return profiles[0];
	}

	const activeUserIds = new Set(SessionManager.getActiveSessions().map(session => session.profile.user.id));
	const items = profiles.map(profile => ({
		label: profile.label,
		description: `${profile.org.id}${activeUserIds.has(profile.user.id) ? '' : ' (inactive)'}`,
		profile,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a session to remove',
	});

	return picked?.profile;
}
