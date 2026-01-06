import type { SessionChangeEvent } from '@events';
import { context } from '@global';
import { Org } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import CookieString from './CookieString';
import Session from './Session';
import SessionProfile from './SessionProfile';

export const SessionManager = new (class _ implements vscode.Disposable {
	interval = setInterval(this.refreshActiveSessions, 15 * 60 * 1000);
	dispose(): void {
		clearInterval(this.interval);
	}

	sessionMap: Map<string, Session> = new Map<string, Session>();

	private readonly sessionChangeEmitter = new vscode.EventEmitter<SessionChangeEvent>();
	private loaded = false;
	private loading = false;
	readonly onSessionChange = this.sessionChangeEmitter.event;

	async init(): Promise<_> {
		await SessionManager.loadSessions();

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

			if (!session.validate()) {
				log.trace('getOrgSession: skipping session, validation failed');
				continue;
			}

			if (session.profile.org.id === orgId) {
				log.debug('getOrgSession: found matching session', { label: session.profile.label });
				return session;
			}

			// make a call to the org and check if this has access
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
		const existing = this.getActiveSessions().map(s => s.profile.user.id ?? '');
		return profiles.filter(f => !existing.includes(f.user.id ?? ''));
	}

	async loadSessions(): Promise<Session[]> {
		log.trace('loadSessions: starting');

		if (this.loading) {
			log.debug('loadSessions: already in progress, skipping');
			return this.getActiveSessions();
		}
		if (this.loaded) {
			log.debug('loadSessions: already loaded, skipping');
			return this.getActiveSessions();
		}

		this.loading = true;
		try {
			const newProfiles = await this.newProfiles();
			log.debug('loadSessions: profiles to load', newProfiles.length);

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
		return context.globalState.get<SessionProfile[]>('RewstAllKnownProfiles', []);
	}

	private async saveKnownProfiles(): Promise<void> {
		const profileMap = new Map<string, SessionProfile>();

		context.globalState
			.get<SessionProfile[]>('RewstAllKnownProfiles', [])
			.concat(this.getSavedProfiles())
			.forEach(profile => profileMap.set(profile.user.id ?? '', profile));

		const profiles = Array.from(profileMap.values());

		await context.globalState.update('RewstAllKnownProfiles', profiles);

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

		this.sessionMap.set(session.profile.user.id, session);
		await this.saveProfiles();
		log.trace('saveSession: saved', { sessionMapSize: this.sessionMap.size });
	}

	private getSavedProfiles(): SessionProfile[] {
		return context.globalState.get<SessionProfile[]>('SessionProfiles') ?? [];
	}

	public clearProfiles() {
		log.debug('clearProfiles: clearing all sessions');
		context.globalState.update('SessionProfiles', []);
		this.sessionMap.clear();

		this.sessionChangeEmitter.fire({
			type: 'cleared',
			allProfiles: this.getAllKnownProfiles(),
			activeProfiles: [],
		});
		log.trace('clearProfiles: cleared');
	}

	public getSessionForOrg(orgId: string): Session {
		log.trace('getSessionForOrg: looking for', orgId);
		const sessions = this.getActiveSessions();
		for (const session of sessions) {
			if (session.profile.allManagedOrgs.map(org => org.id ?? '1').includes(orgId)) {
				log.trace('getSessionForOrg: found', { label: session.profile.label });
				return session;
			}
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
})();
