import type { SessionChangeEvent } from '@events';
import { context } from '@global';
import { Org } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import CookieString from './CookieString';
import RewstSession from './RewstSession';
import RewstSessionProfile from './RewstSessionProfile';

class RewstSessionManager {
	sessionMap: Map<string, RewstSession> = new Map<string, RewstSession>();

	private readonly sessionChangeEmitter = new vscode.EventEmitter<SessionChangeEvent>();
	readonly onSessionChange = this.sessionChangeEmitter.event;

	async createFromProfile(profile: RewstSessionProfile): Promise<RewstSession> {
		let session = new RewstSession(undefined, profile);
		try {
			session = await this.createSession(await session.getCookies());
		} catch {
			log.info('Rewst session could not be loaded from profile');
		}
		return session;
	}

	async createSession(cookies?: string): Promise<RewstSession> {
		let sdk;
		let regionConfig;
		let cookieString;

		if (cookies === undefined) {
			const token = await this.getTokenForCreation();
			[sdk, regionConfig, cookieString] = await RewstSession.newSdk(token);
			cookies = cookieString.value;
		} else {
			[sdk, regionConfig] = await RewstSession.newSdk(cookies, new CookieString(cookies));
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

		const profile: RewstSessionProfile = {
			region: regionConfig,
			label: `${user.username} (${org.name})`,
			org: org,
			allManagedOrgs: allManagedOrgs,
			user: user,
		};
		const session = new RewstSession(sdk, profile);

		await context.secrets.store(org.id, cookies);
		this.saveSession(session);

		this.sessionChangeEmitter.fire({
			type: 'added',
			session,
			allSessions: Array.from(this.sessionMap.values()),
		});

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

	async getProfileSession(profile: RewstSessionProfile): Promise<RewstSession> {
		return this.getOrgSession(profile.org.id, new URL(profile.region.loginUrl));
	}

	async getOrgSession(orgId: string, baseURL: URL): Promise<RewstSession> {
		log.debug('getOrgSession');
		for (const session of await this.loadSessions()) {
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

	private newProfiles(): RewstSessionProfile[] {
		const profiles = this.getSavedProfiles();
		const existing = Array.from(this.sessionMap.values()).map(s => s.profile.user.id ?? '');
		return profiles.filter(f => !existing.includes(f.user.id ?? ''));
	}

	async loadSessions(): Promise<RewstSession[]> {
		const newProfiles = this.newProfiles();

		const resultsPromises = newProfiles.map(async profile => {
			try {
				return await this.createSession(await RewstSession.getCookies(profile.org.id));
			} catch (err) {
				log.error(`Failed to create client for ${profile.org.id}: ${err}`);
				return undefined;
			}
		});

		await Promise.all(resultsPromises);

		return Array.from(this.sessionMap.values());
	}

	private saveProfiles() {
		context.globalState.update(
			'RewstSessionProfiles',
			Array.from(this.sessionMap.values()).map(s => s.profile),
		);
	}

	private saveSession(session: RewstSession) {
		if (typeof session.profile.user.id !== 'string') {
			throw log.error(`Session user doesn't have an id, this should always exist`);
		}

		this.sessionMap.set(session.profile.user.id, session);
		this.saveProfiles();
	}

	private getSavedProfiles(): RewstSessionProfile[] {
		return context.globalState.get<RewstSessionProfile[]>('RewstSessionProfiles') ?? [];
	}

	public clearProfiles() {
		context.globalState.update('RewstSessionProfiles', []);
		this.sessionMap.clear();

		this.sessionChangeEmitter.fire({
			type: 'cleared',
			allSessions: [],
		});
	}
}

export const SessionManager = new RewstSessionManager();
