import { RegionConfig } from './RegionConfig';

export type RewstSessionProfiles = Record<string, RewstSessionProfile>;

export default interface RewstSessionProfile {
	region: RegionConfig;
	orgId: string;
	label: string;
	managedOrgs: Map<string, string>;
} // commands/index.ts
