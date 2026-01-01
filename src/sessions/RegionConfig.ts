import vscode from 'vscode';

export interface RegionConfig {
	name: string;
	cookieName: string;
	graphqlUrl: string;
	loginUrl: string;
}

export function getRegionConfigs(): RegionConfig[] {
	const config = vscode.workspace.getConfiguration('rewst-buddy');
	return config.get<RegionConfig[]>('regions', [
		{
			name: 'North America',
			cookieName: 'appSession',
			graphqlUrl: 'https://api.rewst.io/graphql',
			loginUrl: 'https://app.rewst.io',
		},
	]);
}
