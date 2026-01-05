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
		let session = new Session(undefined, profile);
		try {
			session = await this.createSession(await session.getCookies());
		} catch {
			log.info('Rewst session could not be loaded from profile');
		}
		return session;
	}

	async createSession(cookies?: string): Promise<Session> {
		let sdk;
		let regionConfig;
		let cookieString;

		if (cookies === undefined) {
			const token = await this.getTokenForCreation();
			[sdk, regionConfig, cookieString] = await Session.newSdk(token);
			cookies = cookieString.value;
		} else {
			[sdk, regionConfig, cookieString] = await Session.newSdk(cookies, new CookieString(cookies));
		}

		const response = await sdk.User();
		const user = response.user;
		if (user === undefined) {
			throw log.notifyError('Failed to retrieve current user from Rewst');
		}

		if (user?.organization === undefined) {
			throw log.notifyError('Failed to retrieve org of current user from Rewst');
		}

		if (user?.allManagedOrgs === undefined) {
			throw log.notifyError('Failed to retrieve managed orgs of current user from Rewst');
		}

		const org: Org = {
			id: user.organization?.id ?? '',
			name: user.organization?.name ?? '',
		};

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

		await context.secrets.store(org.id, cookieString.value);
		await this.saveSession(session);

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
		log.debug('getOrgSession');
		for (const session of await this.getActiveSessions()) {
			const regionURL = new URL(session.profile.region.loginUrl);
			if (regionURL.host !== baseURL.host) {
				continue;
			}

			if (!session.validate()) {
				continue;
			}

			if (session.profile.org.id === orgId) {
				return session;
			}

			// make a call to the org and check if this has access
		}

		throw log.error(`No active session found with access to org '${orgId}' in region '${baseURL.host}'`);
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
		if (this.loading) {
			log.debug('Session loading already in progress, skipping');
			return this.getActiveSessions();
		}
		if (this.loaded) {
			log.debug('Sessions already loaded, skipping');
			return this.getActiveSessions();
		}

		this.loading = true;
		try {
			const newProfiles = await this.newProfiles();

			const resultsPromises = newProfiles.map(async profile => {
				try {
					return await this.createSession(await Session.getCookies(profile.org.id));
				} catch (err) {
					log.error(`Failed to create client for ${profile.org.id}: ${err}`);
					return undefined;
				}
			});

			await Promise.all(resultsPromises);
			this.loaded = true;

			await this.saveProfiles();

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
		if (typeof session.profile.user.id !== 'string') {
			throw log.error(`Session user doesn't have an id, this should always exist`);
		}

		this.sessionMap.set(session.profile.user.id, session);
		await this.saveProfiles();
	}

	private getSavedProfiles(): SessionProfile[] {
		return context.globalState.get<SessionProfile[]>('SessionProfiles') ?? [];
	}

	public clearProfiles() {
		context.globalState.update('SessionProfiles', []);
		this.sessionMap.clear();

		this.sessionChangeEmitter.fire({
			type: 'cleared',
			allProfiles: this.getAllKnownProfiles(),
			activeProfiles: [],
		});
	}

	public getSessionForOrg(orgId: string): Session {
		const sessions = this.getActiveSessions();
		for (const session of sessions) {
			if (session.profile.allManagedOrgs.map(org => org.id ?? '1').includes(orgId)) {
				return session;
			}
		}
		throw log.error(`No session found for org id ${orgId}`);
	}

	public async refreshActiveSessions() {
		log.info('Refreshing session cookies');
		const activeSessions = this.getActiveSessions();
		const resultsPromises = activeSessions.map(async session => {
			try {
				await session.refreshToken();
			} catch (err) {
				log.error(`Failed to refresh token for ${session.profile.label}: ${err}`);
				return undefined;
			}
		});

		await Promise.all(resultsPromises);
	}
})();
