import { Link } from '@models';
import type { Session } from '@sessions';
import { SessionProfile } from '@sessions';

export type ChangeType = 'added' | 'removed' | 'cleared' | 'saved';

export interface SessionChangeEvent {
	type: ChangeType;
	session?: Session;
	allProfiles: SessionProfile[];
	activeProfiles: SessionProfile[];
}

export interface LinksSavedEvent {
	links: Link[];
}

export interface SyncOnSaveChangeEvent {
	type: ChangeType;
}
