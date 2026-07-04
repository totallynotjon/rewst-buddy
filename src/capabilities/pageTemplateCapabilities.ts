import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import { asPositiveInt, asString, ORG_ID_PROP, rawGraphqlOrThrow, requireString } from './inputHelpers';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const SEARCH_TEMPLATES_QUERY = `query($orgId: ID!, $search: TemplateSearch, $limit: Int){ templates(where:{ orgId:$orgId }, search:$search, order:[["updatedAt","desc"]], limit:$limit){ id name language contentType updatedAt } }`;
const LIST_PAGES_QUERY = `query($orgId: ID!, $limit: Int){ pages(where:{ orgId:$orgId }, limit:$limit){ id name path siteId } }`;
const LIST_SITES_QUERY = `query($orgId: ID!){ sites(where:{ orgId:$orgId }){ id name domain isLive } }`;
const LIST_JINJA_FILTERS_QUERY = `query{ jinjaFiltersDocumentation { name signature } }`;

const searchTemplatesSpec: ToolSpec = {
	name: 'buddy_search_templates',
	args: '{"orgId": string, "search"?: string, "limit"?: number}',
	description:
		'Search templates in one Rewst organization by name substring (case-insensitive), newest first (id, name, language, contentType, updatedAt). Use buddy_get_template for a full body.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			search: { type: 'string', description: 'Optional case-insensitive name substring.' },
			limit: { type: 'number', description: 'Max templates to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
};

const listPagesSpec: ToolSpec = {
	name: 'buddy_list_pages',
	args: '{"orgId": string, "limit"?: number}',
	description: 'List App Platform pages in one Rewst organization (id, name, path, siteId).',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			limit: { type: 'number', description: 'Max pages to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
};

const listSitesSpec: ToolSpec = {
	name: 'buddy_list_sites',
	args: '{"orgId": string}',
	description:
		'List App Platform sites in one Rewst organization (id, name, domain, isLive). Returns all sites (this field has no pagination).',
	inputSchema: { type: 'object', properties: { ...ORG_ID_PROP }, required: ['orgId'] },
};

const listJinjaFiltersSpec: ToolSpec = {
	name: 'buddy_list_jinja_filters',
	args: '{"orgId": string, "search"?: string, "limit"?: number}',
	description:
		'List Rewst available Jinja filters with their signatures (global catalog, ~100 entries). Optionally filter by a name substring. Use this instead of the broken singular jinjaFilterDocumentation.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			search: { type: 'string', description: 'Optional case-insensitive name substring.' },
			limit: { type: 'number', description: 'Max filters to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
};

async function runSearchTemplates(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const search = asString(input, 'search');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_LIMIT, MAX_LIMIT);
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
	const orgId = requireString(input, 'orgId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_LIMIT, MAX_LIMIT);
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
	const orgId = requireString(input, 'orgId');
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

async function runListJinjaFilters(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	requireString(input, 'orgId');
	const search = asString(input, 'search');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_LIMIT, MAX_LIMIT);
	const variables = {};
	const data = await rawGraphqlOrThrow(ctx.session, LIST_JINJA_FILTERS_QUERY, variables);
	const filters = ((data as { jinjaFiltersDocumentation?: unknown[] } | undefined)?.jinjaFiltersDocumentation ??
		[]) as {
		name?: string | null;
		signature?: string | null;
	}[];
	const matched = search
		? filters.filter(filter => (filter.name ?? '').toLowerCase().includes(search.toLowerCase()))
		: filters;
	const capped = matched.slice(0, limit);
	if (capped.length === 0) return search ? `No Jinja filters found matching "${search}".` : 'No Jinja filters found.';
	const lines = capped.map(
		filter => `${filter.name ?? '(unnamed)'}${filter.signature ? ` - ${filter.signature}` : ''}`,
	);
	if (matched.length > limit) {
		lines.push(`...(${matched.length - limit} more not shown; refine the search)`);
	}
	return lines.join('\n');
}

export const PAGE_TEMPLATE_CAPABILITIES: Capability[] = [
	readCapability(searchTemplatesSpec, runSearchTemplates),
	readCapability(listPagesSpec, runListPages),
	readCapability(listSitesSpec, runListSites),
	readCapability(listJinjaFiltersSpec, runListJinjaFilters),
];
