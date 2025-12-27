import { Org } from '@models';
import { UserFragment } from '@sdk';
import { RegionConfig } from './RegionConfig';

export default interface RewstSessionProfile {
	region: RegionConfig;
	org: Org;
	allManagedOrgs: Org[];
	label: string;
	user: UserFragment;
} // commands/index.ts
