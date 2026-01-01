import type { TemplateLink } from '@models';
import type RewstSession from '@sessions';
import { RewstSessionProfile } from '@sessions';

export type SessionChangeType = 'added' | 'removed' | 'cleared' | 'saved';

export interface SessionChangeEvent {
	type: SessionChangeType;
	session?: RewstSession;
	allProfiles: RewstSessionProfile[];
	activeProfiles: RewstSessionProfile[];
}

export interface LinksSavedEvent {
	links: TemplateLink[];
}
