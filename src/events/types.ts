import type RewstSession from '@client';
import type { TemplateLink } from '@models';

export type SessionChangeType = 'added' | 'removed' | 'cleared';

export interface SessionChangeEvent {
	type: SessionChangeType;
	session?: RewstSession;
	allSessions: RewstSession[];
}

export interface LinksSavedEvent {
	links: TemplateLink[];
}
