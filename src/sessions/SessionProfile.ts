import { Org } from '@models';
import { UserFragment } from '@sessions';
import { RegionConfig } from './RegionConfig';

export default interface SessionProfile {
	region: RegionConfig;
	org: Org;
	allManagedOrgs: Org[];
	label: string;
	user: UserFragment;
} // commands/index.ts
