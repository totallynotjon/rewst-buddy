import { TemplateFragment } from '@sessions';

export interface Org {
	id: string;
	name: string;
}

export type LinkType = 'Folder' | 'Template';

export interface Link {
	uriString: string;
	org: Org;
	type: LinkType;
}

export interface TemplateLink extends Link {
	type: 'Template';
	template: TemplateFragment;
	bodyHash: string;
}

export interface FolderLink extends Link {
	type: 'Folder';
}
