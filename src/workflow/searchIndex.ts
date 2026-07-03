/**
 * Paginated workflow search index: builds and caches an in-process index of
 * every workflow (id, name, org) reachable from a session, then answers
 * name/id searches from that cache without re-listing.
 *
 * Extracted from workflowTools.ts (D1 split).
 */

import { createHash } from 'crypto';
import { type GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import { asStringArg, type ToolRequest } from '../ui/chat/tools/toolProtocol';
import { type ExecResult, firstErrorMessage, formatWorkflowOutput } from './types';

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

// Every workflow the session can reach, in one paginated query. Not scoped by
// orgId: with no `where` the API returns workflows across the whole accessible
// hierarchy — managed orgs AND sub-orgs — each carrying its organization name.
const WORKFLOWS_INDEX_QUERY = `query RewstBuddyWorkflowsIndex($limit: Int, $offset: Int) {
	workflows(limit: $limit, offset: $offset, order: [["name", "asc"]]) {
		id name orgId organization { id name }
	}
}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowIndexEntry {
	id: string;
	name: string;
	orgId: string;
	orgName: string;
}

export interface WorkflowIndex {
	entries: WorkflowIndexEntry[];
	orgs: Map<string, string>;
	orgSummary: string;
	orgCount: number;
	builtAt: number;
	truncated: boolean;
}

interface RawIndexWorkflow {
	id?: string | null;
	name?: string | null;
	orgId?: string | null;
	organization?: { id?: string | null; name?: string | null } | null;
}

interface NameHit {
	entry: WorkflowIndexEntry;
	rank: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const WORKFLOW_INDEX_CACHE_LIMIT = 8;
export const workflowIndexCache = new Map<string, WorkflowIndex>();

/** Test seam: drop the cached index so a build runs fresh. */
export function _resetWorkflowIndexForTesting(): void {
	workflowIndexCache.clear();
}

const WORKFLOW_INDEX_PAGE_SIZE = 2000;
const WORKFLOW_INDEX_MAX_PAGES = 25; // safety bound (~50k workflows)

// ---------------------------------------------------------------------------
// Index build
// ---------------------------------------------------------------------------

export async function buildWorkflowIndex(deps: GraphqlToolDeps): Promise<WorkflowIndex> {
	const entries: WorkflowIndexEntry[] = [];
	const orgs = new Map<string, string>();
	let truncated = false;
	for (let page = 0; page < WORKFLOW_INDEX_MAX_PAGES; page++) {
		const result = await deps.execute(WORKFLOWS_INDEX_QUERY, {
			limit: WORKFLOW_INDEX_PAGE_SIZE,
			offset: page * WORKFLOW_INDEX_PAGE_SIZE,
		});
		const error = firstErrorMessage(result as ExecResult);
		if (error) {
			if (page === 0) throw new Error(`Failed to list workflows: ${error}`);
			break;
		}
		const rows = (result.data as { workflows?: (RawIndexWorkflow | null)[] } | undefined)?.workflows ?? [];
		for (const w of rows) {
			if (!w?.id) continue;
			const orgId = w.orgId ?? w.organization?.id ?? '';
			const orgName = w.organization?.name ?? (orgId || '(unknown org)');
			if (!orgs.has(orgId)) orgs.set(orgId, orgName);
			entries.push({ id: w.id, name: w.name ?? '(unnamed)', orgId, orgName });
		}
		if (rows.length < WORKFLOW_INDEX_PAGE_SIZE) break;
		if (page === WORKFLOW_INDEX_MAX_PAGES - 1) truncated = true;
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return {
		entries,
		orgs,
		orgSummary: summarizeIndexedOrgs(orgs),
		orgCount: orgs.size,
		builtAt: Date.now(),
		truncated,
	};
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function ageString(ms: number): string {
	const seconds = Math.round((Date.now() - ms) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	return `${Math.round(minutes / 60)}h ago`;
}

/** Lowercase and collapse every run of non-alphanumerics to a single space. */
function normalizeText(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => a.localeCompare(b));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export function workflowSearchCacheKey(request: ToolRequest, deps: GraphqlToolDeps): string {
	const payload = stableJson({ scope: deps.cacheScope ?? null, tool: request.tool });
	return createHash('sha256').update(payload).digest('hex');
}

export function getCachedWorkflowIndex(cacheKey: string): WorkflowIndex | undefined {
	const index = workflowIndexCache.get(cacheKey);
	if (!index) return undefined;
	workflowIndexCache.delete(cacheKey);
	workflowIndexCache.set(cacheKey, index);
	return index;
}

export function setCachedWorkflowIndex(cacheKey: string, index: WorkflowIndex): void {
	workflowIndexCache.delete(cacheKey);
	workflowIndexCache.set(cacheKey, index);
	while (workflowIndexCache.size > WORKFLOW_INDEX_CACHE_LIMIT) {
		const oldest = workflowIndexCache.keys().next().value;
		if (oldest === undefined) break;
		workflowIndexCache.delete(oldest);
	}
}

function summarizeIndexedOrgs(orgs: Map<string, string>): string {
	const shown = [...orgs.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.slice(0, 8)
		.map(([id, name]) => `${name} (${id})`);
	const remaining = orgs.size - shown.length;
	return `${shown.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}`;
}

/** Lower is better: 0 exact name, 1 name starts-with the query, 2 all tokens present. */
function nameRank(nameNorm: string, qNorm: string): number {
	if (!qNorm) return 2;
	if (nameNorm === qNorm) return 0;
	if (nameNorm.startsWith(qNorm)) return 1;
	return 2;
}

// ---------------------------------------------------------------------------
// Tool runner
// ---------------------------------------------------------------------------

export async function runWorkflowSearch(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const refresh = request.args.refresh === true;
	const cacheKey = workflowSearchCacheKey(request, deps);
	let index = getCachedWorkflowIndex(cacheKey);
	if (refresh || !index) {
		index = await buildWorkflowIndex(deps);
		setCachedWorkflowIndex(cacheKey, index);
	}

	const rawQuery = (asStringArg(request.args, 'query') ?? '').trim();
	const qLower = rawQuery.toLowerCase();
	const qNorm = normalizeText(rawQuery);
	const qTokens = qNorm.split(' ').filter(Boolean);
	const orgId = asStringArg(request.args, 'orgId');
	const limit = typeof request.args.limit === 'number' ? Math.max(1, Math.min(200, request.args.limit)) : 25;

	const pool = orgId ? index.entries.filter(entry => entry.orgId === orgId) : index.entries;

	const nameHits: NameHit[] = [];
	const orgOnly: WorkflowIndexEntry[] = [];
	for (const entry of pool) {
		if (!rawQuery) {
			nameHits.push({ entry, rank: 2 });
			continue;
		}
		const nameNorm = normalizeText(entry.name);
		const nameMatch = qTokens.every(token => nameNorm.includes(token));
		const idMatch = qLower.length >= 3 && entry.id.toLowerCase().includes(qLower);
		if (nameMatch || idMatch) {
			nameHits.push({ entry, rank: nameMatch ? nameRank(nameNorm, qNorm) : 3 });
		} else if (qTokens.length > 0 && qTokens.every(token => normalizeText(entry.orgName).includes(token))) {
			orgOnly.push(entry);
		}
	}
	nameHits.sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name));

	const total = nameHits.length + orgOnly.length;
	const header =
		`${total} workflow(s)${rawQuery ? ` matching "${rawQuery}"` : ''}` +
		` (index: ${index.entries.length} workflows across ${index.orgCount} org(s)${index.truncated ? ', truncated at the page cap' : ''}, built ${ageString(index.builtAt)}; orgs with indexed workflows: ${index.orgSummary || '(none)'}; refresh:true to rebuild).`;
	if (total === 0) {
		const missingOrgNote =
			orgId && !index.orgs.has(orgId)
				? ` Requested orgId ${orgId} has no workflows in the index: the org may have no workflows, or this session cannot see it.`
				: '';
		return `${header}\nNo matches.${missingOrgNote} Try fewer/looser words, drop orgId, or refresh:true if the workflow is new.`;
	}

	const parts = [header];
	const shown = nameHits.slice(0, limit);
	if (shown.length > 0) {
		if (rawQuery) parts.push('Matched by name:');
		parts.push(
			shown
				.map(h => `- ${h.entry.name}  (id: ${h.entry.id})  org: ${h.entry.orgName} (${h.entry.orgId})`)
				.join('\n'),
		);
		if (nameHits.length > shown.length) {
			parts.push(`…and ${nameHits.length - shown.length} more by name; raise limit or narrow the query.`);
		}
	} else if (rawQuery) {
		parts.push('No workflows matched by name.');
	}
	if (orgOnly.length > 0) {
		const byOrg = new Map<string, { name: string; count: number }>();
		for (const entry of orgOnly) {
			const cur = byOrg.get(entry.orgId) ?? { name: entry.orgName, count: 0 };
			cur.count++;
			byOrg.set(entry.orgId, cur);
		}
		const summary = [...byOrg.entries()].map(([id, v]) => `${v.name} (${v.count}; orgId ${id})`).join(', ');
		parts.push(
			`Plus ${orgOnly.length} workflow(s) in matching org(s), not by name: ${summary}. Pass that orgId to list an org's workflows.`,
		);
	}
	return formatWorkflowOutput(parts.join('\n'));
}
