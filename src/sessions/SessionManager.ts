import type { SessionChangeEvent } from '@events';
import { context, extPrefix } from '@global';
import { Org } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import CookieString from './CookieString';
import Session from './Session';
import SessionProfile from './SessionProfile';

export const SessionManager = new (class _ implements vscode.Disposable {
	private interval: NodeJS.Timeout | undefined;

	dispose(): void {
		this.stopRefreshInterval();
		vscode.commands.executeCommand('setContext', `${extPrefix}.anyActiveSessions`, false);
	}

	sessionMap: Map<string, Session> = new Map<string, Session>();
	private knownProfileOrgIndex = new Map<string, SessionProfile>();
	private orgSessionIndex = new Map<string, Session[]>();
	private knownProfilesCache: SessionProfile[] | undefined;
	private suppressProfileSaves = false;

	private readonly sessionChangeEmitter = new vscode.EventEmitter<SessionChangeEvent>();
	private loaded = false;
	private loading = false;
	readonly onSessionChange = this.sessionChangeEmitter.event;
	private anyActiveSessions = false;

	private setAnyActiveSessions(value: boolean) {
		if (this.anyActiveSessions === value) return; // No change

		vscode.commands.executeCommand('setContext', `${extPrefix}.anyActiveSessions`, value);
		this.anyActiveSessions = value;

		// Start/stop refresh interval based on session state
		if (value) {
			this.startRefreshInterval();
		} else {
			this.stopRefreshInterval();
		}
	}

	private startRefreshInterval(): void {
		if (this.interval) return; // Already running
		log.debug('SessionManager: starting refresh interval');
		this.interval = setInterval(() => this.refreshActiveSessions(), 15 * 60 * 1000);
	}

	private stopRefreshInterval(): void {
		if (!this.interval) return; // Not running
		log.debug('SessionManager: stopping refresh interval');
		clearInterval(this.interval);
		this.interval = undefined;
	}

	hasActiveSessions(): boolean {
		return this.anyActiveSessions;
	}

	init(): _ {
		this.setAnyActiveSessions(false);
		this.rebuildKnownProfileOrgIndex();
		this.loadSessions().catch(err => log.error('SessionManager.init: background session load failed', err));
		return this;
	}

	async createFromProfile(profile: SessionProfile): Promise<Session> {
		log.trace('createFromProfile: starting', { label: profile.label, orgId: profile.org.id });
		let session = new Session(undefined, profile);
		try {
			session = await this.createSession(await session.getCookies());
			log.debug('createFromProfile: session created successfully');
		} catch {
			log.info('createFromProfile: could not load session from profile');
		}
		return session;
	}

	async createSession(cookies?: string): Promise<Session> {
		log.trace('createSession: starting', { hasCookies: !!cookies });

		let sdk;
		let regionConfig;
		let cookieString;

		if (cookies === undefined) {
			log.trace('createSession: prompting for token');
			const token = await this.getTokenForCreation();
			[sdk, regionConfig, cookieString] = await Session.newSdk(token);
			cookies = cookieString.value;
		} else {
			[sdk, regionConfig, cookieString] = await Session.newSdk(cookies, new CookieString(cookies));
		}

		log.debug('createSession: SDK initialized', { region: regionConfig.name });

		log.trace('createSession: fetching user info');
		const response = await sdk.User();
		const user = response.user;
		if (user === undefined) {
			throw log.notifyError('createSession: failed to retrieve user');
		}

		if (user?.organization === undefined) {
			throw log.notifyError('createSession: user has no organization');
		}

		if (user?.allManagedOrgs === undefined) {
			throw log.notifyError('createSession: user has no managed orgs');
		}

		const org: Org = {
			id: user.organization?.id ?? '',
			name: user.organization?.name ?? '',
		};

		log.debug('createSession: user info retrieved', {
			username: user.username,
			orgName: org.name,
			managedOrgCount: user.allManagedOrgs.length,
		});

		const allManagedOrgs: Org[] = user.allManagedOrgs.map(o => {
			return {
				id: o.id ?? '',
				name: o.name ?? '',
			};
		});

		const profile: SessionProfile = {
			region: regionConfig,
			label: `${user.username} (${org.name})`,
			org: org,
			allManagedOrgs: allManagedOrgs,
			user: user,
		};
		const session = new Session(sdk, profile);

		log.trace('createSession: storing cookie and saving session');
		await context.secrets.store(org.id, cookieString.value);
		await this.saveSession(session);

		log.debug('createSession: completed', { label: profile.label });
		return session;
	}

	private async getTokenForCreation(): Promise<string> {
		const token: string = await this.promptToken();

		if (token.length === 0) {
			throw log.error('Provided token is empty');
		}

		if (typeof token !== 'string') {
			throw log.error('Retrieved token is not a string');
		}

		return token;
	}

	async getProfileSession(profile: SessionProfile): Promise<Session> {
		return this.getOrgSession(profile.org.id, new URL(profile.region.loginUrl));
	}

	async getOrgSession(orgId: string, baseURL: URL): Promise<Session> {
		log.trace('getOrgSession: looking for session', { orgId, region: baseURL.host });

		for (const session of await this.getActiveSessions()) {
			const regionURL = new URL(session.profile.region.loginUrl);
			if (regionURL.host !== baseURL.host) {
				log.trace('getOrgSession: skipping session, wrong region', { sessionRegion: regionURL.host });
				continue;
			}

			// ensureValid (not validate) so a stale-but-refreshable session
			// recovers here too, matching getSessionForOrg's contract.
			if (!(await session.ensureValid())) {
				log.trace('getOrgSession: skipping session, validation failed');
				continue;
			}

			const managesOrg =
				session.profile.org.id === orgId || session.profile.allManagedOrgs.some(org => org.id === orgId);
			if (managesOrg) {
				log.debug('getOrgSession: found matching session', { label: session.profile.label });
				return session;
			}
		}

		throw log.error(`getOrgSession: no session found for org '${orgId}' in region '${baseURL.host}'`);
	}

	private async promptToken(): Promise<string> {
		const token = await vscode.window.showInputBox({
			placeHolder: 'Enter your token',
			prompt: 'We need your token to proceed',
			password: true,
		});

		return token ?? '';
	}

	private async newProfiles(): Promise<SessionProfile[]> {
		const profiles = this.getSavedProfiles();
		const existing = new Set(this.getActiveSessions().map(s => s.profile.user.id ?? ''));
		return profiles.filter(f => !existing.has(f.user.id ?? ''));
	}

	async loadSessions(): Promise<Session[]> {
		log.trace('loadSessions: starting');

		const startTime = Date.now();
		const maxWaitMs = 10000; // 10 seconds

		while (this.loading) {
			if (Date.now() - startTime > maxWaitMs) {
				throw log.error('loadSessions: timeout waiting for concurrent load to complete');
			}
			await new Promise(resolve => setTimeout(resolve, 500));
		}
		if (this.loaded) {
			log.debug('loadSessions: already loaded, skipping');
			return this.getActiveSessions();
		}

		this.loading = true;
		try {
			const newProfiles = await this.newProfiles();
			log.debug('loadSessions: profiles to load', newProfiles.length);

			// Defer profile persistence to the single saveProfiles() below
			this.suppressProfileSaves = true;
			try {
				const resultsPromises = newProfiles.map(async profile => {
					log.trace('loadSessions: loading profile', { label: profile.label, orgId: profile.org.id });
					try {
						return await this.createSession(await Session.getCookies(profile.org.id));
					} catch (err) {
						log.error(`loadSessions: failed to create session for ${profile.org.id}: ${err}`);
						return undefined;
					}
				});

				await Promise.all(resultsPromises);
			} finally {
				this.suppressProfileSaves = false;
			}
			this.loaded = true;

			await this.saveProfiles();

			log.debug('loadSessions: completed', { sessionCount: this.sessionMap.size });
			return this.getActiveSessions();
		} finally {
			this.loading = false;
		}
	}

	getActiveSessions() {
		return Array.from(this.sessionMap.values());
	}

	private async saveProfiles(): Promise<void> {
		await context.globalState.update(
			'SessionProfiles',
			this.getActiveSessions().map(s => s.profile),
		);
		await this.saveKnownProfiles();
	}

	public getAllKnownProfiles(): SessionProfile[] {
		if (this.knownProfilesCache === undefined) {
			this.knownProfilesCache = context.globalState.get<SessionProfile[]>('RewstAllKnownProfiles', []);
		}
		return this.knownProfilesCache;
	}

	private rebuildKnownProfileOrgIndex(): void {
		this.knownProfileOrgIndex.clear();
		for (const profile of this.getAllKnownProfiles()) {
			for (const org of profile.allManagedOrgs) {
				this.knownProfileOrgIndex.set(org.id, profile);
			}
		}
	}

	public getProfileForOrg(orgId: string): SessionProfile | undefined {
		return this.knownProfileOrgIndex.get(orgId);
	}

	private async saveKnownProfiles(): Promise<void> {
		const profileMap = new Map<string, SessionProfile>();

		this.getAllKnownProfiles()
			.concat(this.getSavedProfiles())
			.forEach(profile => profileMap.set(profile.user.id ?? '', profile));

		const profiles = Array.from(profileMap.values());

		this.knownProfilesCache = profiles;
		await context.globalState.update('RewstAllKnownProfiles', profiles);
		this.rebuildKnownProfileOrgIndex();

		this.sessionChangeEmitter.fire({
			type: 'saved',
			allProfiles: profiles,
			activeProfiles: this.getActiveSessions().map(s => s.profile),
		});
	}

	private async saveSession(session: Session): Promise<void> {
		log.trace('saveSession: saving', { label: session.profile.label });

		if (typeof session.profile.user.id !== 'string') {
			throw log.error('saveSession: user has no id');
		}

		this.setAnyActiveSessions(true);

		const previous = this.sessionMap.get(session.profile.user.id);
		if (previous && previous !== session) {
			this.unindexSession(previous);
		}
		this.sessionMap.set(session.profile.user.id, session);
		this.indexSession(session);

		if (!this.suppressProfileSaves) {
			await this.saveProfiles();
		}
		log.trace('saveSession: saved', { sessionMapSize: this.sessionMap.size });
	}

	private indexSession(session: Session): void {
		this.addToOrgIndex(session.profile.org.id, session);
		for (const org of session.profile.allManagedOrgs) {
			this.addToOrgIndex(org.id, session);
		}
	}

	// Several active sessions can legitimately manage the same org id (see
	// getSessionForOrg); keep every capable session so resolution can fall
	// through to the next one when the first is no longer valid.
	private addToOrgIndex(orgId: string, session: Session): void {
		const existing = this.orgSessionIndex.get(orgId);
		if (existing) {
			if (!existing.includes(session)) existing.push(session);
		} else {
			this.orgSessionIndex.set(orgId, [session]);
		}
	}

	private unindexSession(session: Session): void {
		this.removeFromOrgIndex(session.profile.org.id, session);
		for (const org of session.profile.allManagedOrgs) {
			this.removeFromOrgIndex(org.id, session);
		}
	}

	private removeFromOrgIndex(orgId: string, session: Session): void {
		const sessions = this.orgSessionIndex.get(orgId);
		if (!sessions) return;

		const remaining = sessions.filter(candidate => candidate !== session);
		if (remaining.length === 0) {
			this.orgSessionIndex.delete(orgId);
		} else if (remaining.length !== sessions.length) {
			this.orgSessionIndex.set(orgId, remaining);
		}
	}

	private getSavedProfiles(): SessionProfile[] {
		return context.globalState.get<SessionProfile[]>('SessionProfiles') ?? [];
	}

	public async clearProfiles(): Promise<void> {
		log.debug('clearProfiles: clearing all sessions');

		// Collect every profile about to be discarded (active sessions plus
		// anything cached or saved as a known profile) before clearing in-memory
		// state, so every primary-org and legacy managed-org secret key gets deleted.
		const profilesToClear = this.getActiveSessions()
			.map(s => s.profile)
			.concat(this.getAllKnownProfiles())
			.concat(this.getSavedProfiles());

		const orgIdsToClear = new Set<string>();
		for (const profile of profilesToClear) {
			orgIdsToClear.add(profile.org.id);
			for (const managedOrg of profile.allManagedOrgs) {
				orgIdsToClear.add(managedOrg.id);
			}
		}

		await Promise.all(Array.from(orgIdsToClear).map(orgId => context.secrets.delete(orgId)));

		await context.globalState.update('SessionProfiles', []);
		await context.globalState.update('RewstAllKnownProfiles', []);
		this.sessionMap.clear();
		this.orgSessionIndex.clear();
		this.knownProfilesCache = undefined;
		this.knownProfileOrgIndex.clear();
		this.setAnyActiveSessions(false);

		this.sessionChangeEmitter.fire({
			type: 'cleared',
			allProfiles: [],
			activeProfiles: [],
		});

		log.trace('clearProfiles: cleared', { secretsCleared: orgIdsToClear.size });
	}

	/**
	 * Removes one authenticated or previously authenticated session — active or
	 * known-only — identified by its profile's user id, without disturbing any
	 * other session. Mirrors clearProfiles() but scoped to a single profile.
	 */
	public async removeSession(userId: string): Promise<void> {
		log.debug('removeSession: removing', userId);

		const session = this.sessionMap.get(userId);
		const knownProfile = this.getAllKnownProfiles().find(profile => profile.user.id === userId);
		const profile = session?.profile ?? knownProfile;
		if (!profile) {
			throw log.error(`removeSession: no active or known session found for user ${userId}`);
		}

		const orgIdsToClear = new Set<string>([profile.org.id, ...profile.allManagedOrgs.map(org => org.id)]);
		await Promise.all(Array.from(orgIdsToClear).map(orgId => context.secrets.delete(orgId)));

		if (session) {
			this.unindexSession(session);
			this.sessionMap.delete(userId);
			this.setAnyActiveSessions(this.sessionMap.size > 0);
		}

		await context.globalState.update(
			'SessionProfiles',
			this.getSavedProfiles().filter(saved => saved.user.id !== userId),
		);

		const remainingKnown = this.getAllKnownProfiles().filter(known => known.user.id !== userId);
		this.knownProfilesCache = remainingKnown;
		await context.globalState.update('RewstAllKnownProfiles', remainingKnown);
		this.rebuildKnownProfileOrgIndex();

		this.sessionChangeEmitter.fire({
			type: 'removed',
			session,
			allProfiles: remainingKnown,
			activeProfiles: this.getActiveSessions().map(s => s.profile),
		});

		log.info(`removeSession: removed ${profile.label}`);
	}

	public async getSessionForOrg(orgId: string): Promise<Session> {
		log.trace('getSessionForOrg: looking for', orgId);
		for (const session of this.orgSessionIndex.get(orgId) ?? []) {
			// ensureValid (not validate) so a stale-but-refreshable session
			// recovers here rather than being skipped in favor of a worse
			// fallback, or a false "no session manages this org".
			if (await session.ensureValid()) {
				log.trace('getSessionForOrg: found', { label: session.profile.label });
				return session;
			}
			log.trace('getSessionForOrg: skipping invalid session', { label: session.profile.label });
		}
		throw log.error(`getSessionForOrg: no session found for ${orgId}`);
	}

	public async refreshActiveSessions() {
		log.debug('refreshActiveSessions: starting');
		const activeSessions = this.getActiveSessions();
		log.trace('refreshActiveSessions: sessions to refresh', activeSessions.length);

		const resultsPromises = activeSessions.map(async session => {
			log.trace('refreshActiveSessions: refreshing', { label: session.profile.label });
			try {
				await session.refreshToken();
				log.trace('refreshActiveSessions: success', { label: session.profile.label });
			} catch (err) {
				log.error(`refreshActiveSessions: failed for ${session.profile.label}: ${err}`);
				return undefined;
			}
		});

		await Promise.all(resultsPromises);
		log.debug('refreshActiveSessions: completed');
	}

	/**
	 * FOR TESTING ONLY: Set sessions directly for unit tests
	 * @param sessions - Sessions to set as active
	 */
	_setSessionsForTesting(sessions: Session[]): void {
		this.sessionMap.clear();
		this.orgSessionIndex.clear();
		sessions.forEach(session => {
			const userId = session.profile.user.id;
			if (userId) {
				this.sessionMap.set(userId, session);
				this.indexSession(session);
			}
		});
		this.setAnyActiveSessions(sessions.length > 0);
		this.rebuildKnownProfileOrgIndex();
		this.sessionChangeEmitter.fire({
			type: 'saved',
			allProfiles: sessions.map(s => s.profile),
			activeProfiles: sessions.map(s => s.profile),
		});
	}

	/**
	 * FOR TESTING ONLY: Set known profiles without active sessions
	 */
	_setKnownProfilesForTesting(profiles: SessionProfile[]): void {
		this.knownProfilesCache = profiles;
		context.globalState.update('RewstAllKnownProfiles', profiles);
		this.rebuildKnownProfileOrgIndex();
	}

	/**
	 * FOR TESTING ONLY: Reset SessionManager to initial state
	 */
	_resetForTesting(): void {
		this.sessionMap.clear();
		this.knownProfileOrgIndex.clear();
		this.orgSessionIndex.clear();
		this.knownProfilesCache = undefined;
		this.suppressProfileSaves = false;
		this.loaded = false;
		this.loading = false;
		this.setAnyActiveSessions(false);
		this.sessionChangeEmitter.fire({
			type: 'cleared',
			allProfiles: [],
			activeProfiles: [],
		});
	}
})();
