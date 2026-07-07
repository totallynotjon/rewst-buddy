/**
 * Read-only access to Rewst's Jinja filter documentation.
 *
 * Rewst publishes its Jinja intellisense catalog (the same data its in-app
 * editor uses for autocomplete) at `/jinja/intellisense/filters` on the region's
 * engine host. This capability fetches that catalog and serves it to assistants
 * so they can look up filter signatures and docs while writing Rewst templates,
 * instead of guessing. The catalog is platform-wide (not org-scoped), so the
 * tool needs no orgId; the engine host is derived from the session's region.
 */

import { log } from '@utils';
import { z } from 'zod';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import { optionalStringField, parseCapabilityInput, toInputSchema } from './inputHelpers';

const FILTERS_PATH = '/jinja/intellisense/filters';
const DEFAULT_ENGINE_BASE = 'https://engine.rewst.io';
/** Upper bound on filters rendered for a search, before output-level capping. */
const MAX_SEARCH_RESULTS = 25;
/** Abort the catalog fetch if the engine host stalls, so a call can't hang. */
const FETCH_TIMEOUT_MS = 10_000;

export interface JinjaFilterDoc {
	/** Filter name as used in a pipe, e.g. `center`. */
	name: string;
	/** Parameter signature when the filter takes arguments, e.g. `(width=80)`. */
	signature?: string;
	/** Human-readable documentation, possibly multi-line. */
	documentation: string;
}

interface FormatInput {
	name?: string;
	search?: string;
}

/** Fetches and parses the filter catalog for one engine base URL. */
export type JinjaFilterFetcher = (engineBaseUrl: string) => Promise<JinjaFilterDoc[]>;

let activeFetcher: JinjaFilterFetcher | undefined;
const cacheByBase = new Map<string, JinjaFilterDoc[]>();

/** Test seam: replace the network fetcher with a stub. */
export function _setJinjaFilterFetcherForTesting(fetcher: JinjaFilterFetcher): void {
	activeFetcher = fetcher;
}

/** Test seam: restore the default network fetcher. */
export function _resetJinjaFilterFetcherForTesting(): void {
	activeFetcher = undefined;
}

/** Test seam: drop the in-memory catalog cache. */
export function _resetJinjaFilterCacheForTesting(): void {
	cacheByBase.clear();
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * Parses Rewst's intellisense payload into filter docs. Each entry's name comes
 * from `label.label` (or a bare string `label`, or `insertText`); the optional
 * parameter signature from `label.detail`; documentation from
 * `documentation.value` (or a bare string `documentation`). Malformed entries
 * without a name are skipped; results are sorted by name for stable output.
 */
export function parseJinjaFilters(payload: unknown): JinjaFilterDoc[] {
	if (!Array.isArray(payload)) {
		throw new Error('Unexpected Jinja filter payload: expected a JSON array.');
	}
	const filters: JinjaFilterDoc[] = [];
	for (const item of payload) {
		if (!item || typeof item !== 'object') continue;
		const record = item as Record<string, unknown>;
		const label = record.label;
		let name: string | undefined;
		let signature: string | undefined;
		if (typeof label === 'string') {
			name = label;
		} else if (label && typeof label === 'object') {
			const labelRecord = label as Record<string, unknown>;
			name = readString(labelRecord.label);
			signature = readString(labelRecord.detail);
		}
		name ??= readString(record.insertText);
		if (!name) continue;

		const doc = record.documentation;
		let documentation = '';
		if (typeof doc === 'string') {
			documentation = doc;
		} else if (doc && typeof doc === 'object') {
			documentation = readString((doc as Record<string, unknown>).value) ?? '';
		}
		filters.push({ name, signature, documentation });
	}
	filters.sort((a, b) => a.name.localeCompare(b.name));
	return filters;
}

function displayName(filter: JinjaFilterDoc): string {
	return filter.signature ? `${filter.name}${filter.signature}` : filter.name;
}

function renderFull(filter: JinjaFilterDoc): string {
	const doc = filter.documentation.trim() || '(no documentation provided)';
	return `## ${displayName(filter)}\n\n${doc}`;
}

/**
 * Renders the catalog for the caller. With no arguments, lists every filter name
 * and signature compactly (one per line). With `name`, returns full docs for the
 * single matching filter (case-insensitive). With `search`, returns full docs
 * for filters whose name or documentation contains the term. `name` wins when
 * both are supplied.
 */
export function formatJinjaFilters(filters: JinjaFilterDoc[], input: FormatInput): string {
	const name = input.name?.trim();
	if (name) {
		const lower = name.toLowerCase();
		const match = filters.find(f => f.name.toLowerCase() === lower);
		if (!match) {
			return `Jinja filter "${name}" not found. Call buddy_get_jinja_filter_docs with no arguments to see all filter names, or with "search" to match by keyword.`;
		}
		return renderFull(match);
	}

	const search = input.search?.trim();
	if (search) {
		const lower = search.toLowerCase();
		const matches = filters.filter(
			f => f.name.toLowerCase().includes(lower) || f.documentation.toLowerCase().includes(lower),
		);
		if (matches.length === 0) {
			return `No Jinja filters match "${search}". Call buddy_get_jinja_filter_docs with no arguments to see all filter names.`;
		}
		const shown = matches.slice(0, MAX_SEARCH_RESULTS);
		const header =
			matches.length > shown.length
				? `${matches.length} Jinja filters match "${search}" (showing first ${shown.length}; narrow your search to see the rest):`
				: `${matches.length} Jinja filter${matches.length === 1 ? '' : 's'} match "${search}":`;
		return [header, '', ...shown.map(renderFull)].join('\n\n');
	}

	const lines = filters.map(f => `- ${displayName(f)}`);
	return [
		`${filters.length} Jinja filters available. Pass "name" for one filter's full docs, or "search" to match by keyword.`,
		'',
		...lines,
	].join('\n');
}

/** Derives the engine host from a region's graphqlUrl (api.* → engine.*). Pure. */
export function engineBaseFromRegion(graphqlUrl: string | undefined): string {
	if (typeof graphqlUrl !== 'string') return DEFAULT_ENGINE_BASE;
	try {
		const url = new URL(graphqlUrl);
		if (!url.host.startsWith('api.')) return DEFAULT_ENGINE_BASE;
		return `${url.protocol}//engine.${url.host.slice('api.'.length)}`;
	} catch {
		return DEFAULT_ENGINE_BASE;
	}
}

/** Derives the engine host from the session's region (api.* → engine.*). */
function engineBaseFrom(ctx: CapabilityContext): string {
	return engineBaseFromRegion(ctx.session?.profile?.region?.graphqlUrl);
}

async function defaultFetcher(engineBaseUrl: string): Promise<JinjaFilterDoc[]> {
	const url = `${engineBaseUrl}${FILTERS_PATH}`;
	const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!response.ok) {
		throw new Error(
			`Failed to fetch Jinja filter docs from ${url}: HTTP ${response.status} ${response.statusText}`,
		);
	}
	return parseJinjaFilters(await response.json());
}

/** Cache-or-fetch the filter catalog for one engine base URL. */
async function getFiltersForBase(base: string): Promise<JinjaFilterDoc[]> {
	const cached = cacheByBase.get(base);
	if (cached) return cached;
	const fetcher = activeFetcher ?? defaultFetcher;
	const filters = await fetcher(base);
	cacheByBase.set(base, filters);
	return filters;
}

/** Synchronous cache read for the completion/hover path — never fetches. */
export function getCachedFilters(base: string): JinjaFilterDoc[] | undefined {
	return cacheByBase.get(base);
}

/** Fire-and-forget background fetch for the completion/hover path on a cache miss. */
export function primeFilters(base: string): void {
	getFiltersForBase(base).catch(error => {
		log.debug(`Jinja filter catalog fetch failed for ${base}: ${error}`);
	});
}

async function getFilters(ctx: CapabilityContext): Promise<JinjaFilterDoc[]> {
	return getFiltersForBase(engineBaseFrom(ctx));
}

const getJinjaFilterDocsInputSchema = z.object({
	name: optionalStringField().describe('Exact filter name to fetch full documentation for (case-insensitive).'),
	search: optionalStringField().describe('Keyword to match against filter names and documentation.'),
});

const getJinjaFilterDocsSpec: ToolSpecDefinition = {
	name: 'buddy_get_jinja_filter_docs',
	description:
		'Read the documentation for Rewst\'s built-in Jinja filters (the same catalog Rewst\'s in-app editor uses, including the prose docs that buddy_list_jinja_filters omits). Pass "name" for one filter\'s full documentation, or "search" to match filters by name or documentation keyword. With no arguments, lists every filter name and signature so you can pick one. Read-only and not org-specific.',
	inputSchema: toInputSchema(getJinjaFilterDocsInputSchema),
};

async function runGetJinjaFilterDocs(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const filters = await getFilters(ctx);
	const { name, search } = parseCapabilityInput(getJinjaFilterDocsInputSchema, input);
	return formatJinjaFilters(filters, { name, search });
}

export const JINJA_DOCS_CAPABILITIES: Capability[] = [
	readCapability(getJinjaFilterDocsSpec, runGetJinjaFilterDocs, { requiresOrg: false }),
];
