import { context } from '@global';
import { log } from '@log';
import { getSdk, Sdk, SdkFunctionWrapper } from '@sdk';
import { GraphQLClient } from 'graphql-request';
import vscode from 'vscode';
import { getRegionConfigs, RegionConfig } from './RegionConfig';
import RewstSessionProfile from './RewstSessionProfile';
import { createRetryWrapper } from './wrappers';

function parseCookieString(cookieString: string): Record<string, string> {
	const cookies: Record<string, string> = {};

	cookieString.split(';').forEach(pair => {
		const trimmedPair = pair.trim();
		const [key, value] = trimmedPair.split('=');

		if (key && value) {
			cookies[key] = value;
		}
	});

	return cookies;
}

export default class RewstSession {
	private secrets: vscode.SecretStorage;
	private lastValidated = 0;

	public constructor(
		public sdk: Sdk | undefined,
		public profile: RewstSessionProfile,
	) {
		this.secrets = context.secrets;
	}

	private static newSdkAtRegion(token: string, config: RegionConfig): Sdk {
		const client = new GraphQLClient(config.graphqlUrl, {
			errorPolicy: 'all',
			method: 'POST',
			headers: () => ({
				cookie: `${config.cookieName}=${token}`,
			}),
		});

		const wrapper = RewstSession.getWrapper();
		const sdk = getSdk(client, wrapper);
		return sdk;
	}

	public static async newSdk(token: string): Promise<[Sdk, RegionConfig]> {
		const configs = getRegionConfigs();
		let sdk;
		let myConfig;
		for (const config of configs) {
			sdk = RewstSession.newSdkAtRegion(token, config);
			if (await RewstSession.validateSdk(sdk)) {
				myConfig = config;
				break;
			}
		}
		if (!sdk || !myConfig) {
			throw log.notifyError('Could not initialize session with any known region. Did you enter a valid cookie?');
		}

		return [sdk, myConfig];
	}

	private static getWrapper(): SdkFunctionWrapper | undefined {
		return createRetryWrapper();
	}

	private static async validateSdk(sdk: Sdk): Promise<boolean> {
		try {
			const response = await sdk.UserOrganization();
			return typeof response.userOrganization?.id === 'string';
		} catch (error) {
			log.error(`SDK validation failed: ${error}`);
			return false;
		}
	}

	public async validate(): Promise<boolean> {
		if (this.sdk === undefined) {
			return false;
		}

		const ONE_DAY_MS = 24 * 60 * 60 * 1000;

		const now = Date.now();
		if (this.lastValidated >= now - ONE_DAY_MS) {
			return true;
		}

		const valid = await RewstSession.validateSdk(this.sdk);
		if (valid) this.lastValidated = Date.now();

		return valid;
	}

	public async refreshToken() {
		const config = this.profile.region;
		try {
			const oldToken = await this.getToken();

			const response = await fetch(config.loginUrl, {
				method: 'GET',
				headers: {
					cookie: `${config.cookieName}=${oldToken}`,
				},
			});

			if (!response.ok) {
				throw log.notifyError(`Token refresh request failed with status: ${response.status}`);
			}

			const cookieString = response.headers.get('set-cookie');
			if (!cookieString) {
				throw log.notifyError('Token refresh response missing set-cookie header');
			}

			const cookies = parseCookieString(cookieString);
			const appSession = cookies[config.cookieName];

			if (typeof appSession !== 'string') {
				throw log.notifyError('New session token not found in response cookies');
			}

			const sdk = RewstSession.newSdkAtRegion(appSession, config);
			if (!(await RewstSession.validateSdk(sdk))) {
				throw log.notifyError('Refreshed token failed SDK validation');
			}

			await this.secrets.store(this.profile.orgId, appSession);
			this.sdk = sdk;
			log.info(`Successfully refreshed token for ${this.profile.label} ${this.profile.orgId}`);
		} catch (error) {
			log.notifyError(`Token refresh failed for ${this.profile.label}: ${error}`);
			throw error;
		}
	}

	public static async getToken(orgId: string): Promise<string> {
		const token = await context.secrets.get(orgId);

		if (typeof token !== 'string') {
			throw log.notifyError(`Failed to retrieve token for orgId: ${orgId}`);
		}

		return token;
	}

	async getToken(): Promise<string> {
		return await RewstSession.getToken(this.profile.orgId);
	}
}
