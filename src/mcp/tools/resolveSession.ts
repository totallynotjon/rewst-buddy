import { SessionManager, Session } from '@sessions';

export function resolveSession(orgId?: string): Session {
	const sessions = SessionManager.getActiveSessions();

	if (sessions.length === 0) {
		throw new Error('No active Rewst sessions. Open VS Code and create a session first.');
	}

	if (orgId) {
		try {
			return SessionManager.getSessionForOrg(orgId);
		} catch {
			const available = sessions
				.flatMap(s => s.profile.allManagedOrgs)
				.map(o => `  - ${o.name} (${o.id})`)
				.join('\n');
			throw new Error(`No session found for org "${orgId}". Available orgs:\n${available}`);
		}
	}

	if (sessions.length === 1) {
		return sessions[0];
	}

	const available = sessions
		.map(s => `  - ${s.profile.label} — org: ${s.profile.org.name} (${s.profile.org.id})`)
		.join('\n');
	throw new Error(
		`Multiple sessions active. Specify orgId. Use rewst_list_sessions to see available sessions.\n${available}`,
	);
}
