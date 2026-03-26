import { Org, TemplateLink } from './types';

export interface TemplateBundle {
	/** Root template ID (or arbitrary for cycles) */
	id: string;
	/** Display name for the bundle (root name, with ID suffix on collision) */
	displayName: string;
	/** The root template link */
	root: TemplateLink;
	/** All templates in the bundle (including root), flat */
	members: TemplateLink[];
}

export interface OrgBundles {
	org: Org;
	bundles: TemplateBundle[];
	/** Templates with no outgoing or incoming references */
	standalone: TemplateLink[];
}
