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
		this.detachAllSessionExpirationListeners();
		vscode.commands.executeCommand('setContext', `${extPrefix}.anyActiveSessions`, false);
	}

	sessionMap: Map<string, Session> = new Map<string, Session>();
	private knownProfileOrgIndex = new Map<string, SessionProfile>();
	private orgSessionIndex = new Map<string, Session[]>();
	private sessionExpiredDisposables = new Map<Session, vscode.Disposable>();
	private knownProfilesCache: SessionProfile[] | undefined;
	// Single promise shared by all concurrent loadSessions() callers.
	// Undefined means not yet started; set to the in-flight promise while loading;
	// resolves to the loaded sessions and stays set afterwards.
	private loadPromise: Promise<Session[]> | undefined;
	// True only while _doLoad is actually running (not merely while loadPromise is set),
	// so removeSession can tell whether a removal races an in-flight load.
	private loadInFlight = false;
	// User ids removed while loadSessions was in flight; the load reconciles
	// these afterwards so a completed createSession cannot resurrect them.
	private removedDuringLoad = new Set<string>();

	private readonly sessionChangeEmitter = new vscode.EventEmitter<SessionChangeEvent>();
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

	async createSession(cookies?: string, options: { persist?: boolean } = {}): Promise<Session> {
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

		// Two distinct scopes that only overlap partially: allManagedOrgs is every
		// org the user directly manages (flat, can span other MSP trees), while
		// managedAndSubOrgs is the recursive sub-org tree of the user's own org.
		// Sessions must reach both, so index their union.
		if (user.allManagedOrgs === undefined && user.organization?.managedAndSubOrgs === undefined) {
			throw log.notifyError('createSession: user has no managed orgs');
		}
		const managedOrgRows = [...(user.allManagedOrgs ?? []), ...(user.organization?.managedAndSubOrgs ?? [])];

		const org: Org = {
			id: user.organization?.id ?? '',
			name: user.organization?.name ?? '',
		};

		log.debug('createSession: user info retrieved', {
			username: user.username,
			orgName: org.name,
			managedOrgCount: managedOrgRows.length,
		});

		const allManagedOrgMap = new Map<string, Org>();
		for (const o of [org, ...managedOrgRows]) {
			const mapped = { id: o.id ?? '', name: o.name ?? '' };
			if (mapped.id) allManagedOrgMap.set(mapped.id, mapped);
		}
		const allManagedOrgs = [...allManagedOrgMap.values()];

		const profile: SessionProfile = {
			region: regionConfig,
			label: `${user.username} (${org.name})`,
			org: org,
			allManagedOrgs: allManagedOrgs,
			user: user,
		};
		const session = new Session(sdk, profile);

		log.trace('createSession: storing cookie and registering session');
		// D4: store under user id so two users with the same primary org get separate secrets.
		const userId = profile.user.id;
		if (!userId) throw log.error('createSession: user has no id');
		await context.secrets.store(userId, cookieString.value);
		// Clean up any legacy org-keyed secret now that we have the user-keyed one.
		await context.secrets.delete(org.id);
		if (options.persist === false) {
			this.registerSession(session);
		} else {
			await this.saveSession(session);
		}

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

		// D4: share a single promise across concurrent callers — no polling.
		if (this.loadPromise !== undefined) {
			log.debug('loadSessions: returning shared in-flight or completed promise');
			return this.loadPromise;
		}

		this.loadPromise = this._doLoad().catch(err => {
			// Clear the promise on failure so a later call can retry.
			this.loadPromise = undefined;
			throw err;
		});
		return this.loadPromise;
	}

	private async _doLoad(): Promise<Session[]> {
		this.loadInFlight = true;
		try {
			const newProfiles = await this.newProfiles();
			log.debug('loadSessions: profiles to load', newProfiles.length);

			const resultsPromises = newProfiles.map(async profile => {
				log.trace('loadSessions: loading profile', { label: profile.label, orgId: profile.org.id });
				try {
					// D4: try user-id key first, fall back to legacy org-id key for migration.
					const userId = profile.user.id;
					let cookies: string | undefined;
					if (userId) {
						cookies = await context.secrets.get(userId);
					}
					if (!cookies) {
						// Legacy org-id key: migrate by reading and re-storing under user-id.
						cookies = await context.secrets.get(profile.org.id);
						if (cookies && userId) {
							log.debug('loadSessions: migrating legacy org-keyed secret to user-keyed', {
								userId,
								orgId: profile.org.id,
							});
						}
					}
					if (!cookies) {
						log.error(`loadSessions: no cookie found for profile ${profile.label}`);
						return undefined;
					}
					return await this.createSession(cookies, { persist: false });
				} catch (err) {
					log.error(`loadSessions: failed to create session for ${profile.org.id}: ${err}`);
					return undefined;
				}
			});

			await Promise.all(resultsPromises);
			await this.saveProfiles();
		} finally {
			this.loadInFlight = false;
		}

		// A profile removed while its cookie-driven load was still in flight may
		// have been resurrected by createSession completing afterwards; purge it
		// again now that the load has settled.
		const toPurge = Array.from(this.removedDuringLoad);
		this.removedDuringLoad.clear();
		for (const userId of toPurge) {
			if (this.sessionMap.has(userId)) {
				log.debug('loadSessions: purging session resurrected past its removal', userId);
				await this.removeSession(userId);
			}
		}

		log.debug('loadSessions: completed', { sessionCount: this.sessionMap.size });
		return this.getActiveSessions();
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
		this.registerSession(session);

		await this.saveProfiles();
		log.trace('saveSession: saved', { sessionMapSize: this.sessionMap.size });
	}

	private registerSession(session: Session): void {
		if (typeof session.profile.user.id !== 'string') {
			throw log.error('registerSession: user has no id');
		}

		this.setAnyActiveSessions(true);

		const previous = this.sessionMap.get(session.profile.user.id);
		if (previous && previous !== session) {
			this.unindexSession(previous);
		}
		this.sessionMap.set(session.profile.user.id, session);
		this.indexSession(session);
	}

	private indexSession(session: Session): void {
		this.attachSessionExpirationListener(session);
		this.addToOrgIndex(session.profile.org.id, session);
		for (const org of session.profile.allManagedOrgs) {
			this.addToOrgIndex(org.id, session);
		}
	}

	private attachSessionExpirationListener(session: Session): void {
		if (this.sessionExpiredDisposables.has(session)) return;
		this.sessionExpiredDisposables.set(
			session,
			session.onExpired(expiredSession => this.handleSessionExpired(expiredSession)),
		);
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
		this.detachSessionExpirationListener(session);
		this.removeFromOrgIndex(session.profile.org.id, session);
		for (const org of session.profile.allManagedOrgs) {
			this.removeFromOrgIndex(org.id, session);
		}
	}

	private detachSessionExpirationListener(session: Session): void {
		this.sessionExpiredDisposables.get(session)?.dispose();
		this.sessionExpiredDisposables.delete(session);
	}

	private detachAllSessionExpirationListeners(): void {
		for (const disposable of this.sessionExpiredDisposables.values()) {
			disposable.dispose();
		}
		this.sessionExpiredDisposables.clear();
	}

	private profilesForSessionChange(extraProfiles: SessionProfile[] = []): SessionProfile[] {
		const profiles = [
			...this.getAllKnownProfiles(),
			...this.getSavedProfiles(),
			...this.getActiveSessions().map(s => s.profile),
			...extraProfiles,
		];
		const byUser = new Map<string, SessionProfile>();
		for (const profile of profiles) {
			byUser.set(profile.user.id ?? profile.org.id, profile);
		}
		return Array.from(byUser.values());
	}

	private handleSessionExpired(session: Session): void {
		const userId = session.profile.user.id;
		if (!userId || this.sessionMap.get(userId) !== session) return;

		this.unindexSession(session);
		this.sessionMap.delete(userId);
		this.setAnyActiveSessions(this.sessionMap.size > 0);
		this.sessionChangeEmitter.fire({
			type: 'removed',
			session,
			allProfiles: this.profilesForSessionChange([session.profile]),
			activeProfiles: this.getActiveSessions().map(s => s.profile),
		});
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

		// D4: delete user-id keyed secrets (plus legacy org-id keys for cleanup).
		const secretKeysToClear = new Set<string>();
		for (const profile of profilesToClear) {
			if (profile.user.id) secretKeysToClear.add(profile.user.id);
			secretKeysToClear.add(profile.org.id); // legacy cleanup
			for (const managedOrg of profile.allManagedOrgs) {
				secretKeysToClear.add(managedOrg.id); // legacy cleanup
			}
		}

		await Promise.all(Array.from(secretKeysToClear).map(key => context.secrets.delete(key)));

		await context.globalState.update('SessionProfiles', []);
		await context.globalState.update('RewstAllKnownProfiles', []);
		this.detachAllSessionExpirationListeners();
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

		log.trace('clearProfiles: cleared', { secretsCleared: secretKeysToClear.size });
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

		// Drop the session from the in-memory indexes before any await so a
		// concurrent getSessionForOrg cannot resolve a session the user has
		// already confirmed removing.
		if (session) {
			this.unindexSession(session);
			this.sessionMap.delete(userId);
			this.setAnyActiveSessions(this.sessionMap.size > 0);
		}

		// A load in flight may have already read this profile's cookie and can
		// re-create the session after this removal completes; mark it so
		// loadSessions purges any such resurrection once the load finishes.
		if (this.loadInFlight) {
			this.removedDuringLoad.add(userId);
		}

		// D4: delete the user-id keyed secret. Also clean up any legacy org-id key.
		await context.secrets.delete(userId);
		await context.secrets.delete(profile.org.id);

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
		this.detachAllSessionExpirationListeners();
		this.sessionMap.clear();
		this.knownProfileOrgIndex.clear();
		this.orgSessionIndex.clear();
		this.knownProfilesCache = undefined;
		this.loadPromise = undefined;
		this.loadInFlight = false;
		this.removedDuringLoad.clear();
		this.setAnyActiveSessions(false);
		this.sessionChangeEmitter.fire({
			type: 'cleared',
			allProfiles: [],
			activeProfiles: [],
		});
	}
})();
