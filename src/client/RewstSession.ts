import { context } from '@global';
import { log } from '@log';
import { getSdk, Sdk, SdkFunctionWrapper } from '@sdk';
import { GraphQLClient } from 'graphql-request';
import vscode from 'vscode';
import CookieString from './CookeString';
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

	private static newSdkAtRegion(cookieString: CookieString, config: RegionConfig): Sdk {
		const client = new GraphQLClient(config.graphqlUrl, {
			errorPolicy: 'all',
			method: 'POST',
			headers: () => ({
				cookie: cookieString.value,
			}),
		});

		const wrapper = RewstSession.getWrapper();
		const sdk = getSdk(client, wrapper);
		return sdk;
	}

	public static async newSdk(
		token?: string,
		cookieString?: CookieString,
	): Promise<[Sdk, RegionConfig, CookieString]> {
		if (cookieString === undefined && token === undefined) {
			throw log.error('Must provide a token or set of cookies to make a new sdk');
		}

		const configs = getRegionConfigs();

		for (const config of configs) {
			const cookies = cookieString ?? CookieString.fromToken(token ?? '', config);
			const sdk = RewstSession.newSdkAtRegion(cookies, config);
			try {
				if (await RewstSession.validateSdk(sdk)) {
					return [sdk, config, cookies];
				}
			} catch {
				log.trace(`Couldn't init for region ${config.name}`);
			}
		}
		throw log.notifyError('Could not initialize session with any known region. Did you enter a valid cookie?');
	}

	private static getWrapper(): SdkFunctionWrapper | undefined {
		return createRetryWrapper();
	}

	private static async validateSdk(sdk: Sdk): Promise<boolean> {
		try {
			const response = await sdk.User();
			return typeof response.user?.id === 'string';
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
			const oldCookies = await this.getCookies();

			const response = await fetch(config.loginUrl, {
				method: 'GET',
				headers: {
					cookie: oldCookies,
				},
			});

			if (!response.ok) {
				throw log.notifyError(`Token refresh request failed with status: ${response.status}`);
			}

			const cookieString = response.headers.get('set-cookie');
			if (!cookieString) {
				throw log.notifyError('Token refresh response missing set-cookie header');
			}

			const sdk = RewstSession.newSdkAtRegion(new CookieString(cookieString), config);
			if (!(await RewstSession.validateSdk(sdk))) {
				throw log.notifyError('Refreshed token failed SDK validation');
			}

			await this.secrets.store(this.profile.org.id, cookieString);
			this.sdk = sdk;
			log.info(`Successfully refreshed token for ${this.profile.label} ${this.profile.org.id}`);
		} catch (error) {
			log.notifyError(`Token refresh failed for ${this.profile.label}: ${error}`);
			throw error;
		}
	}

	public static async getCookies(orgId: string): Promise<string> {
		const token = await context.secrets.get(orgId);

		if (typeof token !== 'string') {
			throw log.notifyError(`Failed to retrieve token for orgId: ${orgId}`);
		}

		return token;
	}

	async getCookies(): Promise<string> {
		return await RewstSession.getCookies(this.profile.org.id);
	}
}
