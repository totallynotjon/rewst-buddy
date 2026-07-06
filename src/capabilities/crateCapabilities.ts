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

/**
 * buddy_search_crates — search Rewst Crates (prebuilt automations).
 * Two sources: "catalog" (default, marketplace visible to the session) and
 * "public" (the public crate listing, filtered client-side).
 */

const DEFAULT_CRATE_LIMIT = 25;
const MAX_CRATE_LIMIT = 100;
/** Fixed server page size for publicCrates (no search param supported). */
const PUBLIC_CRATES_PAGE = 200;
const DESCRIPTION_MAX = 200;

const CRATE_SOURCES = ['catalog', 'public'] as const;
type CrateSource = (typeof CRATE_SOURCES)[number];

const sourceMessage = (received: unknown): string => {
	const val = received === undefined || received === null || received === '' ? '(empty)' : String(received);
	return `Invalid source "${val}". Valid source values: ${CRATE_SOURCES.join(', ')}`;
};

const CATALOG_QUERY = `
query RewstBuddyMcpCrates($selectedOrgId: ID, $search: CrateSearchInput, $limit: Int) {
  crates(selectedOrgId: $selectedOrgId, search: $search, limit: $limit) {
    id
    name
    category
    description
    isUnpackedForSelectedOrg
  }
}
`.trim();

const PUBLIC_QUERY = `
query RewstBuddyMcpPublicCrates($limit: Int) {
  publicCrates(limit: $limit) {
    id
    name
    category
    description
  }
}
`.trim();

interface CrateRow {
	id?: string | null;
	name?: string | null;
	category?: string | null;
	description?: string | null;
	isUnpackedForSelectedOrg?: boolean | null;
}

function truncateDescription(desc: string | null | undefined): string | undefined {
	if (!desc) return undefined;
	if (desc.length <= DESCRIPTION_MAX) return desc;
	return desc.slice(0, DESCRIPTION_MAX) + '\u2026';
}

function formatCrateRow(crate: CrateRow, showInstalled: boolean): string {
	const name = crate.name ?? '(unnamed)';
	const id = crate.id ?? '(unknown)';
	const category = crate.category ?? 'uncategorized';
	let line = `- ${name} (${id}) — ${category}`;
	if (showInstalled && crate.isUnpackedForSelectedOrg === true) {
		line += ' [installed in this org]';
	}
	const desc = truncateDescription(crate.description);
	if (desc) {
		line += `: ${desc}`;
	}
	return line;
}

const searchCratesInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	search: optionalStringField().describe('Optional case-insensitive crate-name substring filter.'),
	source: z
		.preprocess(
			raw => (typeof raw === 'string' ? raw.trim() : raw),
			z
				.enum(CRATE_SOURCES, {
					error: issue => sourceMessage(issue.input),
				})
				.optional(),
		)
		.describe(
			'Where to search: "catalog" (default — the marketplace visible to the signed-in session, with per-org install status) or "public" (the public crate listing).',
		) as z.ZodType<CrateSource | undefined>,
	limit: optionalClampedInt(MAX_CRATE_LIMIT).describe(
		`Max crates to return (default ${DEFAULT_CRATE_LIMIT}, max ${MAX_CRATE_LIMIT}).`,
	),
});

type SearchCratesInput = z.infer<typeof searchCratesInputSchema>;

async function runCatalogSearch(
	orgId: string,
	search: SearchCratesInput['search'],
	limit: number,
	ctx: CapabilityContext,
): Promise<string> {
	const variables: Record<string, unknown> = {
		selectedOrgId: orgId,
		limit,
	};
	if (search !== undefined) {
		variables.search = { name: { _ilike: `%${search}%` } };
	}

	const data = await rawGraphqlOrThrow(ctx.session, CATALOG_QUERY, variables);
	const crates = (data as { crates?: CrateRow[] | null } | undefined)?.crates ?? [];

	if (crates.length === 0) {
		return search ? `No crates found matching "${search}".` : 'No crates found.';
	}

	const lines = [`${crates.length} crate(s) found:`];
	for (const crate of crates) {
		lines.push(formatCrateRow(crate, true));
	}
	return lines.join('\n');
}

async function runPublicSearch(
	search: SearchCratesInput['search'],
	limit: number,
	ctx: CapabilityContext,
): Promise<string> {
	const data = await rawGraphqlOrThrow(ctx.session, PUBLIC_QUERY, { limit: PUBLIC_CRATES_PAGE });
	let crates = (data as { publicCrates?: CrateRow[] | null } | undefined)?.publicCrates ?? [];

	// Client-side name filter
	if (search !== undefined) {
		const lower = search.toLowerCase();
		crates = crates.filter(c => (c.name ?? '').toLowerCase().includes(lower));
	}

	// Slice to the requested limit
	crates = crates.slice(0, limit);

	if (crates.length === 0) {
		return search ? `No crates found matching "${search}".` : 'No crates found.';
	}

	const lines = [`${crates.length} crate(s) found:`];
	for (const crate of crates) {
		lines.push(formatCrateRow(crate, false));
	}
	return lines.join('\n');
}

async function runSearchCrates(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, search, source, limit } = parseCapabilityInput(searchCratesInputSchema, input);
	const effectiveLimit = limit ?? DEFAULT_CRATE_LIMIT;
	const effectiveSource = source ?? 'catalog';

	if (effectiveSource === 'public') {
		return runPublicSearch(search, effectiveLimit, ctx);
	}
	return runCatalogSearch(orgId, search, effectiveLimit, ctx);
}

const searchCratesSpec: ToolSpecDefinition = {
	name: 'buddy_search_crates',
	description:
		'Search Rewst Crates — prebuilt, Rewst-maintained automations that can be unpacked into an organization. The default source searches the crate catalog visible to the signed-in session, matches the filter against crate names case-insensitively, and marks crates already unpacked in the given org. Pass source "public" for the public crate listing instead. Use this before building a new workflow to check whether a prebuilt Crate already covers the request.',
	inputSchema: toInputSchema(searchCratesInputSchema),
};

export const CRATE_CAPABILITIES: Capability[] = [readCapability(searchCratesSpec, runSearchCrates)];
