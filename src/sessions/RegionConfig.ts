import { log } from '@utils';
import vscode from 'vscode';

export interface RegionConfig {
	name: string;
	cookieName: string;
	graphqlUrl: string;
	loginUrl: string;
}

export function getRegionConfigs(): RegionConfig[] {
	const config = vscode.workspace.getConfiguration('rewst-buddy');
	const regions = config.get<RegionConfig[]>('regions', [
		{
			name: 'North America',
			cookieName: 'appSession',
			graphqlUrl: 'https://api.rewst.io/graphql',
			loginUrl: 'https://app.rewst.io',
		},
	]);

	if (regions.length === 0)
		throw log.notifyError(
			`No regions were found in vscode config. Sessions cannot be created if there are no defined regions`,
		);
	return regions;
}
