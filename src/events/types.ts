import type { TemplateLink } from '@models';
import type RewstSession from '@sessions';
import { RewstSessionProfile } from '@sessions';

export type ChangeType = 'added' | 'removed' | 'cleared' | 'saved';

export interface SessionChangeEvent {
	type: ChangeType;
	session?: RewstSession;
	allProfiles: RewstSessionProfile[];
	activeProfiles: RewstSessionProfile[];
}

export interface LinksSavedEvent {
	links: TemplateLink[];
}

export interface SyncOnSaveChangeEvent {
	type: ChangeType;
}
