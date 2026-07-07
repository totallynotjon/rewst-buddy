import { z } from 'zod';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	optionalClampedInt,
	optionalStringField,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	toInputSchema,
} from './inputHelpers';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const searchTemplatesInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	search: optionalStringField().describe('Optional case-insensitive name substring.'),
	limit: optionalClampedInt(MAX_LIMIT).describe(
		`Max templates to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
	),
});

const listPagesInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	limit: optionalClampedInt(MAX_LIMIT).describe(`Max pages to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
});

const listSitesInputSchema = z.object({
	orgId: ORG_ID_FIELD,
});

const SEARCH_TEMPLATES_QUERY = `query($orgId: ID!, $search: TemplateSearch, $limit: Int){ templates(where:{ orgId:$orgId }, search:$search, order:[["updatedAt","desc"]], limit:$limit){ id name language contentType updatedAt } }`;
const LIST_PAGES_QUERY = `query($orgId: ID!, $limit: Int){ pages(where:{ orgId:$orgId }, limit:$limit){ id name path siteId } }`;
const LIST_SITES_QUERY = `query($orgId: ID!){ sites(where:{ orgId:$orgId }){ id name domain isLive } }`;

const searchTemplatesSpec: ToolSpecDefinition = {
	name: 'buddy_search_templates',
	description:
		'Search templates in one Rewst organization by name substring (case-insensitive), newest first (id, name, language, contentType, updatedAt). Use buddy_get_template for a full body.',
	inputSchema: toInputSchema(searchTemplatesInputSchema),
};

const listPagesSpec: ToolSpecDefinition = {
	name: 'buddy_list_pages',
	description: 'List App Platform pages in one Rewst organization (id, name, path, siteId).',
	inputSchema: toInputSchema(listPagesInputSchema),
};

const listSitesSpec: ToolSpecDefinition = {
	name: 'buddy_list_sites',
	description:
		'List App Platform sites in one Rewst organization (id, name, domain, isLive). Returns all sites (this field has no pagination).',
	inputSchema: toInputSchema(listSitesInputSchema),
};

async function runSearchTemplates(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, search, limit: rawLimit } = parseCapabilityInput(searchTemplatesInputSchema, input);
	const limit = rawLimit ?? DEFAULT_LIMIT;
	const variables: Record<string, unknown> = { orgId, limit };
	if (search) variables.search = { name: { _ilike: `%${search}%` } };
	const data = await rawGraphqlOrThrow(ctx.session, SEARCH_TEMPLATES_QUERY, variables);
	const templates = ((data as { templates?: unknown[] } | undefined)?.templates ?? []) as {
		id?: string | null;
		name?: string | null;
		language?: string | null;
		contentType?: string | null;
		updatedAt?: string | null;
	}[];
	if (templates.length === 0) return 'No templates found for this organization.';
	return templates
		.map(template => {
			const details = [
				template.language,
				template.contentType,
				template.updatedAt ? `updated ${template.updatedAt}` : undefined,
			]
				.filter(Boolean)
				.join(', ');
			return `${template.name ?? '(unnamed)'} (${template.id ?? '(unknown id)'})${details ? ` - ${details}` : ''}`;
		})
		.join('\n');
}

async function runListPages(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, limit: rawLimit } = parseCapabilityInput(listPagesInputSchema, input);
	const limit = rawLimit ?? DEFAULT_LIMIT;
	const variables = { orgId, limit };
	const data = await rawGraphqlOrThrow(ctx.session, LIST_PAGES_QUERY, variables);
	const pages = ((data as { pages?: unknown[] } | undefined)?.pages ?? []) as {
		id?: string | null;
		name?: string | null;
		path?: string | null;
		siteId?: string | null;
	}[];
	if (pages.length === 0) return 'No pages found for this organization.';
	return pages
		.map(page => {
			const details = [page.path, page.siteId ? `site ${page.siteId}` : undefined].filter(Boolean).join(', ');
			return `${page.name ?? '(unnamed)'} (${page.id ?? '(unknown id)'})${details ? ` - ${details}` : ''}`;
		})
		.join('\n');
}

async function runListSites(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId } = parseCapabilityInput(listSitesInputSchema, input);
	const variables = { orgId };
	const data = await rawGraphqlOrThrow(ctx.session, LIST_SITES_QUERY, variables);
	const sites = ((data as { sites?: unknown[] } | undefined)?.sites ?? []) as {
		id?: string | null;
		name?: string | null;
		domain?: string | null;
		isLive?: boolean | null;
	}[];
	if (sites.length === 0) return 'No sites found for this organization.';
	return sites
		.map(site => {
			const domain = site.domain ? ` - ${site.domain}` : '';
			const live = site.isLive ? ' [live]' : ' [not live]';
			return `${site.name ?? '(unnamed)'} (${site.id ?? '(unknown id)'})${domain}${live}`;
		})
		.join('\n');
}

export const PAGE_TEMPLATE_CAPABILITIES: Capability[] = [
	readCapability(searchTemplatesSpec, runSearchTemplates),
	readCapability(listPagesSpec, runListPages),
	readCapability(listSitesSpec, runListSites),
];
