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
	private static readonly MAX_REFRESH_FAILURES = 3;
	private secrets: vscode.SecretStorage;
	private lastValidated = 0;
	private refreshPromise: Promise<void> | undefined;
	private consecutiveRefreshFailures = 0;
	private expired = false;
	private readonly expiredEmitter = new vscode.EventEmitter<Session>();
	readonly onExpired = this.expiredEmitter.event;

	public constructor(
		public sdk: Sdk | undefined,
		public profile: SessionProfile,
	) {
		this.secrets = context.secrets;
	}

	private static createClient(graphqlUrl: string, cookie: string): GraphQLClient {
		return new GraphQLClient(graphqlUrl, {
			errorPolicy: 'all',
			method: 'POST',
			headers: () => ({ cookie }),
		});
	}

	private static newSdkAtRegion(cookieString: CookieString, config: RegionConfig): Sdk {
		log.trace('newSdkAtRegion: creating SDK', { region: config.name, url: config.graphqlUrl });

		const client = Session.createClient(config.graphqlUrl, cookieString.value);
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

		if (this.expired) {
			log.debug('validate: session is expired');
			return false;
		}

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

	/**
	 * Validates the session, attempting one refresh if the check fails, so a
	 * merely stale (but still logged-in) cookie recovers instead of being
	 * treated as dead. Used by org resolution, where skipping a session over
	 * an unattempted refresh would wrongly report the org unreachable.
	 */
	public async ensureValid(): Promise<boolean> {
		if (await this.validate()) return true;

		try {
			await this.refreshToken();
		} catch {
			return false;
		}

		// refreshToken() already re-validated the refreshed SDK and stamped
		// lastValidated, so a second live validate() here would just repeat the
		// same network call it already made.
		return true;
	}

	/**
	 * Single-flights concurrent refresh requests onto one in-progress attempt so
	 * callers (the 15-minute background refresh, ensureValid(), and any other
	 * caller) racing each other don't fire duplicate logins or clobber each
	 * other's cookie/SDK writes.
	 */
	public async refreshToken(): Promise<void> {
		if (this.refreshPromise) return this.refreshPromise;

		this.refreshPromise = this.performRefresh();
		try {
			await this.refreshPromise;
		} finally {
			this.refreshPromise = undefined;
		}
	}

	public isExpired(): boolean {
		return this.expired;
	}

	private async performRefresh(): Promise<void> {
		log.trace('refreshToken: starting', { label: this.profile.label, orgId: this.profile.org.id });

		const config = this.profile.region;
		try {
			const oldCookies = await this.getCookiesForRefresh();

			log.trace('refreshToken: fetching new token from', config.loginUrl);
			const response = await fetch(config.loginUrl, {
				method: 'GET',
				headers: {
					cookie: oldCookies,
				},
			});

			log.debug('refreshToken: response status', response.status);

			if (!response.ok) {
				throw log.error(`refreshToken: failed with status ${response.status}`);
			}

			const cookieString = response.headers.get('set-cookie');
			if (!cookieString) {
				throw log.error('refreshToken: missing set-cookie header');
			}

			log.trace('refreshToken: validating new SDK');
			const sdk = Session.newSdkAtRegion(new CookieString(cookieString), config);
			if (!(await Session.validateSdk(sdk))) {
				throw log.error('refreshToken: new SDK validation failed');
			}

			log.trace('refreshToken: storing new cookie');
			await this.secrets.store(this.profile.org.id, cookieString);
			this.sdk = sdk;
			this.lastValidated = Date.now();
			this.consecutiveRefreshFailures = 0;
			this.expired = false;
			log.info(`refreshToken: success for ${this.profile.label}`);
		} catch (error) {
			this.recordRefreshFailure(error);
			throw error;
		}
	}

	private async getCookiesForRefresh(): Promise<string> {
		log.trace('refreshToken: retrieving stored cookie for org', this.profile.org.id);
		const token = await this.secrets.get(this.profile.org.id);

		if (typeof token !== 'string') {
			throw log.error(`refreshToken: no token found for ${this.profile.org.id}`);
		}

		return token;
	}

	private recordRefreshFailure(error: unknown): void {
		this.lastValidated = 0;

		if (this.expired) {
			log.debug(`refreshToken: expired session refresh failed for ${this.profile.label}: ${error}`);
			return;
		}

		this.consecutiveRefreshFailures++;
		if (this.consecutiveRefreshFailures < Session.MAX_REFRESH_FAILURES) {
			log.debug('refreshToken: failed', {
				label: this.profile.label,
				consecutiveFailures: this.consecutiveRefreshFailures,
				error,
			});
			return;
		}

		this.expired = true;
		log.warn('refreshToken: session expired after repeated refresh failures', {
			label: this.profile.label,
			consecutiveFailures: this.consecutiveRefreshFailures,
			error,
		});
		this.showExpiredNotification();
		this.expiredEmitter.fire(this);
	}

	private showExpiredNotification(): void {
		void vscode.window
			.showErrorMessage(
				`Rewst Buddy session "${this.profile.label}" has expired. Re-authenticate to continue syncing.`,
				'Re-authenticate',
			)
			.then(choice => {
				if (choice === 'Re-authenticate') {
					void vscode.commands.executeCommand('rewst-buddy.FocusSidebar');
				}
			});
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

	/**
	 * Executes an arbitrary GraphQL document against this session's region
	 * endpoint, authenticated with the stored session cookie. Used by the
	 * dedicated GraphQL MCP capabilities; the extension's own operations use
	 * the typed SDK.
	 */
	public async rawGraphql(
		query: string,
		variables?: Record<string, unknown>,
	): Promise<{ data?: unknown; errors?: unknown }> {
		const cookie = await this.getCookies();
		const client = Session.createClient(this.profile.region.graphqlUrl, cookie);
		const wrapper = createRetryWrapper();
		const { data, errors } = await wrapper(() => client.rawRequest(query, variables), 'rawGraphql');
		return { data, errors };
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
