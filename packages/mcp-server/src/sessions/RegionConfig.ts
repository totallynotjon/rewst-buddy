import { getRuntimeHost, log } from '../host';

export interface RegionConfig {
	name: string;
	cookieName: string;
	graphqlUrl: string;
	loginUrl: string;
	subscriptionsUrl?: string;
}

// The WS endpoint lives at /subscriptions, not /graphql (a WS upgrade against
// /graphql falls through to Apollo's HTTP handler and returns 400).
export function getSubscriptionsUrl(config: RegionConfig): string {
	if (config.subscriptionsUrl) return config.subscriptionsUrl;

	const url = new URL(config.graphqlUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = '/subscriptions';
	url.search = '';
	url.hash = '';
	return url.toString();
}

export function getRegionConfigs(): RegionConfig[] {
	const regions = getRuntimeHost().getSetting<RegionConfig[]>('regions', [
		{
			name: 'North America',
			cookieName: 'appSession',
			graphqlUrl: 'https://api.rewst.io/graphql',
			loginUrl: 'https://app.rewst.io',
		},
		{
			name: 'United Kingdom',
			cookieName: 'euAppSession',
			graphqlUrl: 'https://api.eu.rewst.io/graphql',
			loginUrl: 'https://app.eu.rewst.io',
		},
		{
			name: 'Asia',
			cookieName: 'auAppSession',
			graphqlUrl: 'https://api.rewst.asia/graphql',
			loginUrl: 'https://app.rewst.asia',
		},
		{
			name: 'Europe',
			cookieName: 'deAppSession',
			graphqlUrl: 'https://api.rewst.eu/graphql',
			loginUrl: 'https://app.rewst.eu',
		},
	]);

	if (regions.length === 0)
		throw log.notifyError(
			`No regions were found in runtime host settings. Sessions cannot be created if there are no defined regions`,
		);
	return regions;
}
