import { context } from '@global';
import { getSdk, Sdk, SdkFunctionWrapper } from '@sessions';
import { log } from '@utils';
import { GraphQLClient } from 'graphql-request';
import vscode from 'vscode';
import CookieString from './CookieString';
import { getRegionConfigs, RegionConfig } from './RegionConfig';
import SessionProfile from './SessionProfile';
import { createRetryWrapper } from './retryWrapper';

export default class Session {
	private secrets: vscode.SecretStorage;
	private lastValidated = 0;

	public constructor(
		public sdk: Sdk | undefined,
		public profile: SessionProfile,
	) {
		this.secrets = context.secrets;
	}

	private static newSdkAtRegion(cookieString: CookieString, config: RegionConfig): Sdk {
		log.trace('newSdkAtRegion: creating SDK', { region: config.name, url: config.graphqlUrl });

		const client = new GraphQLClient(config.graphqlUrl, {
			errorPolicy: 'all',
			method: 'POST',
			headers: () => ({
				cookie: cookieString.value,
			}),
		});

		const wrapper = Session.getWrapper();
		const sdk = getSdk(client, wrapper);
		return sdk;
	}

	public static async newSdk(
		token?: string,
		cookieString?: CookieString,
	): Promise<[Sdk, RegionConfig, CookieString]> {
		log.trace('newSdk: starting', { hasToken: !!token, hasCookieString: !!cookieString });

		if (cookieString === undefined && token === undefined) {
			throw log.error('newSdk: no token or cookies provided');
		}

		const configs = getRegionConfigs();
		log.debug(
			'newSdk: trying regions',
			configs.map(c => c.name),
		);

		for (const config of configs) {
			log.trace('newSdk: attempting region', config.name);

			let cookieStrings: CookieString[] = [];
			if (token !== undefined) {
				cookieStrings = cookieStrings
					.concat(CookieString.fromToken(token ?? '', config))
					.concat(new CookieString(token));
			}

			if (cookieString !== undefined) {
				cookieStrings = cookieStrings
					.concat(cookieString)
					.concat(CookieString.fromToken(cookieString.value ?? '', config));
			}

			for (const cookieString of cookieStrings) {
				const sdk = Session.newSdkAtRegion(cookieString, config);
				try {
					if (await Session.validateSdk(sdk)) {
						log.debug('newSdk: succeeded with region', config.name);
						return [sdk, config, cookieString];
					}
				} catch {
					log.trace('newSdk: failed for region', config.name);
				}
			}
		}
		throw log.notifyError('newSdk: could not initialize with any region');
	}

	private static getWrapper(): SdkFunctionWrapper | undefined {
		return createRetryWrapper();
	}

	private static async validateSdk(sdk: Sdk): Promise<boolean> {
		log.trace('validateSdk: querying User()');
		try {
			const response = await sdk.User();
			const valid = typeof response.user?.id === 'string';
			log.trace('validateSdk: result', { valid, userId: response.user?.id });
			return valid;
		} catch (error) {
			log.debug('validateSdk: failed', error);
			return false;
		}
	}

	public async validate(): Promise<boolean> {
		log.trace('validate: checking session', this.profile.org.id);

		if (this.sdk === undefined) {
			log.debug('validate: no SDK present');
			return false;
		}

		const ONE_DAY_MS = 24 * 60 * 60 * 1000;

		const now = Date.now();
		if (this.lastValidated >= now - ONE_DAY_MS) {
			log.trace('validate: cache hit, skipping validation');
			return true;
		}

		log.trace('validate: cache expired, validating SDK');
		const valid = await Session.validateSdk(this.sdk);
		if (valid) this.lastValidated = Date.now();

		log.debug('validate: result', { valid, orgId: this.profile.org.id });
		return valid;
	}

	public async refreshToken() {
		log.trace('refreshToken: starting', { label: this.profile.label, orgId: this.profile.org.id });

		const config = this.profile.region;
		try {
			const oldCookies = await this.getCookies();

			log.trace('refreshToken: fetching new token from', config.loginUrl);
			const response = await fetch(config.loginUrl, {
				method: 'GET',
				headers: {
					cookie: oldCookies,
				},
			});

			log.debug('refreshToken: response status', response.status);

			if (!response.ok) {
				throw log.notifyError(`refreshToken: failed with status ${response.status}`);
			}

			const cookieString = response.headers.get('set-cookie');
			if (!cookieString) {
				throw log.notifyError('refreshToken: missing set-cookie header');
			}

			log.trace('refreshToken: validating new SDK');
			const sdk = Session.newSdkAtRegion(new CookieString(cookieString), config);
			if (!(await Session.validateSdk(sdk))) {
				throw log.notifyError('refreshToken: new SDK validation failed');
			}

			log.trace('refreshToken: storing new cookie');
			await this.secrets.store(this.profile.org.id, cookieString);
			this.sdk = sdk;
			log.info(`refreshToken: success for ${this.profile.label}`);
		} catch (error) {
			log.notifyError(`refreshToken: failed for ${this.profile.label}: ${error}`);
			throw error;
		}
	}

	public static async getCookies(orgId: string): Promise<string> {
		log.trace('getCookies: retrieving for org', orgId);
		const token = await context.secrets.get(orgId);

		if (typeof token !== 'string') {
			throw log.notifyError(`getCookies: no token found for ${orgId}`);
		}

		log.trace('getCookies: retrieved successfully');
		return token;
	}

	async getCookies(): Promise<string> {
		return await Session.getCookies(this.profile.org.id);
	}

	async getTemplate(templateId: string) {
		log.trace('getTemplate: fetching', templateId);
		const response = await this.sdk?.getTemplate({ id: templateId });
		if (!response?.template) {
			throw log.error(`getTemplate: not found '${templateId}'`);
		}
		log.trace('getTemplate: found', { id: response.template.id, name: response.template.name });
		return response.template;
	}
}
