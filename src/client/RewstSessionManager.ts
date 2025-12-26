import { context } from '@global';
import { log } from '@log';
import vscode from 'vscode';
import RewstSession from './RewstSession';
import RewstSessionProfile from './RewstSessionProfile';

class RewstSessionManager {
	sessions: RewstSession[] = [];
	profiles: RewstSessionProfile[] = [];

	async createFromProfile(profile: RewstSessionProfile): Promise<RewstSession> {
		let session = new RewstSession(undefined, profile);
		try {
			session = await this.createSession(await session.getToken());
		} catch {
			log.info('Rewst session could not be loaded from profile');
		}
		return session;
	}

	async createSession(token?: string): Promise<RewstSession> {
		if (!token) {
			token = await this.getTokenForCreation();
		}

		const [sdk, regionConfig] = await RewstSession.newSdk(token);

		const response = await sdk.UserOrganization();
		const org = response.userOrganization;

		if (typeof org?.id !== 'string') {
			throw log.notifyError('Failed to retrieve organization ID from API');
		}

		const managedOrgs: Map<string, string> = new Map<string, string>();

		for (const orgItem of org?.managedOrgs ?? []) {
			managedOrgs.set(orgItem.id ?? '', org.name);
		}

		await context.secrets.store(org.id, token);
		const profile: RewstSessionProfile = {
			region: regionConfig,
			orgId: org.id,
			label: org.name,
			managedOrgs: managedOrgs,
		};
		const session = new RewstSession(sdk, profile);
		await session.refreshToken();

		this.saveNewProfile(session.profile);

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
		return this.getOrgSession(profile.orgId, new URL(profile.region.loginUrl));
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

			if (session.profile.orgId === orgId) {
				return session;
			}

			if (orgId in session.profile.managedOrgs.keys()) {
				return session;
			}
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
		const existing = this.profiles.map(p => JSON.stringify(p));
		return profiles.filter(f => !existing.includes(JSON.stringify(f)));
	}

	async loadSessions(): Promise<RewstSession[]> {
		const newProfiles = this.newProfiles();

		const resultsPromises = newProfiles.map(async profile => {
			try {
				return await this.createSession(await RewstSession.getToken(profile.orgId));
			} catch (err) {
				log.error(`Failed to create client for ${profile.orgId}: ${err}`);
				return undefined;
			}
		});

		const results = await Promise.all(resultsPromises);

		const sessions = results.filter((c): c is RewstSession => c !== undefined);
		log.info(`Successfully loaded ${sessions.length} sessions`);

		this.sessions = this.sessions.concat(sessions);
		this.profiles = this.sessions.map(s => s.profile);
		this.saveProfiles(this.profiles);
		// only keep track of open session profiles

		return this.sessions;
	}

	private saveProfiles(profiles: RewstSessionProfile[]) {
		context.globalState.update('RewstSessionProfiles', profiles);
	}

	private saveNewProfile(profile: RewstSessionProfile) {
		const profiles = this.getSavedProfiles();

		context.globalState.update('RewstSessionProfiles', profiles.concat(profile));
	}

	private getSavedProfiles(): RewstSessionProfile[] {
		return context.globalState.get<RewstSessionProfile[]>('RewstSessionProfiles') ?? [];
	}

	public clearProfiles() {
		context.globalState.update('RewstSessionProfiles', {});
	}
}

export const SessionManager = new RewstSessionManager();
