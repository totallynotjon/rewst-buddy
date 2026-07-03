import type { TemplateFragment } from '@sessions';
import { findAllTemplateReferences } from '../providers/templatePatternUtils';
import { getHash } from '../utils/getHash';
import { nonEmptyString, type Org, type TemplateLink } from './types';

type TemplateWithOrg = Omit<TemplateFragment, 'organization'> & {
	orgId: string;
	organization?: { id?: string | null; name?: string | null } | null;
};

/**
 * The org a template actually belongs to, taken from the template itself — not
 * from the session's primary org. One session manages a parent org plus its
 * sub-orgs, so a sub-org template's link must record the sub-org. Falls back
 * to the orgId when the organization relation is absent.
 */
export function orgFromTemplate(template: TemplateWithOrg): Org {
	const id = nonEmptyString(template.orgId) ?? nonEmptyString(template.organization?.id) ?? template.orgId;
	return { id, name: template.organization?.name ?? id };
}

export function buildTemplateLink(template: TemplateWithOrg, body: string, uriString: string): TemplateLink {
	return {
		type: 'Template',
		template: template as TemplateFragment,
		bodyHash: getHash(body),
		referencedTemplateIds: findAllTemplateReferences(body),
		uriString,
		org: orgFromTemplate(template),
	};
}
