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
	referencedTemplateIds?: string[];
}

export interface FolderLink extends Link {
	type: 'Folder';
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * A few older flows stored the session's primary org on the link while the
 * template fragment itself carried the sub-org it actually belonged to. Prefer
 * the template's org when present so UI/tool surfaces agree on the real owner.
 */
export function orgForTemplateLink(link: TemplateLink): Org {
	const templateOrgId = nonEmptyString(link.template.orgId) ?? nonEmptyString(link.template.organization?.id);
	if (!templateOrgId) return link.org;

	const templateOrgName = nonEmptyString(link.template.organization?.name);
	if (templateOrgName) return { id: templateOrgId, name: templateOrgName };
	if (templateOrgId === link.org.id && link.org.name) return link.org;
	return { id: templateOrgId, name: templateOrgId };
}
