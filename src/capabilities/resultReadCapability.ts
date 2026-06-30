import { randomUUID } from 'crypto';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability } from './Capability';

export const RESULT_READ_TOOL_NAME = 'buddy_result_read';
export const MCP_MAX_OUTPUT_CHARS = 24_000;

const MCP_RESULT_CACHE_LIMIT_BYTES = 64 * 1024 * 1024;
const DEFAULT_READ_LIMIT = 6_000;
const MAX_READ_LIMIT = 8_000;
const MAX_SEARCH_HITS = 50;
const SEARCH_OUTPUT_CHARS = 6_000;
const MAX_LINE_CHARS = 500;

interface CacheEntry {
	id: string;
	tool: string;
	text: string;
	bytes: number;
}

type StoreResult = { id: string } | { tooLarge: true; bytes: number };

export class McpResultCache {
	private entries = new Map<string, CacheEntry>();
	private totalBytes = 0;

	constructor(private readonly limitBytes: number = MCP_RESULT_CACHE_LIMIT_BYTES) {}

	store(tool: string, text: string): StoreResult {
		const bytes = Buffer.byteLength(text, 'utf8');
		if (bytes > this.limitBytes) return { tooLarge: true, bytes };
		while (this.totalBytes + bytes > this.limitBytes && this.entries.size > 0) this.evictOldest();
		const id = this.freshId();
		this.entries.set(id, { id, tool, text, bytes });
		this.totalBytes += bytes;
		return { id };
	}

	get(id: string): CacheEntry | undefined {
		return this.entries.get(id);
	}

	get size(): number {
		return this.entries.size;
	}

	get usedBytes(): number {
		return this.totalBytes;
	}

	clear(): void {
		this.entries.clear();
		this.totalBytes = 0;
	}

	private evictOldest(): void {
		const oldest = this.entries.keys().next().value as string | undefined;
		if (oldest === undefined) return;
		const entry = this.entries.get(oldest);
		if (entry) this.totalBytes -= entry.bytes;
		this.entries.delete(oldest);
	}

	private freshId(): string {
		let id = randomUUID().slice(0, 8);
		while (this.entries.has(id)) id = randomUUID().slice(0, 8);
		return id;
	}
}

export const mcpResultCache = new McpResultCache();

export function formatMcpOutput(toolName: string, text: string, cache: McpResultCache = mcpResultCache): string {
	if (toolName === RESULT_READ_TOOL_NAME) return text;
	if (text.length <= MCP_MAX_OUTPUT_CHARS) return text;

	const preview = text.slice(0, MCP_MAX_OUTPUT_CHARS);
	const bytes = Buffer.byteLength(text, 'utf8');
	const stored = cache.store(toolName, text);
	if ('tooLarge' in stored) {
		return [
			preview,
			`...(output exceeded ${MCP_MAX_OUTPUT_CHARS} characters; the full ${formatBytes(bytes)} result exceeds the in-memory cache budget and cannot be paged. Narrow the request and rerun the original tool.)`,
		].join('\n');
	}

	return [
		preview,
		`...(output exceeded ${MCP_MAX_OUTPUT_CHARS} characters; the full result is cached in memory as id "${stored.id}" and is ${formatBytes(bytes)} (${bytes} bytes).)`,
		`Continue with the ${RESULT_READ_TOOL_NAME} Buddy tool: {"id":"${stored.id}","offset":${preview.length}}`,
		`Search cached result with the ${RESULT_READ_TOOL_NAME} Buddy tool: {"id":"${stored.id}","search":"<text>"}`,
	].join('\n');
}

const resultReadSpec: ToolSpec = {
	name: RESULT_READ_TOOL_NAME,
	description:
		'Pages or searches an oversized cached Rewst Buddy result by id. The cache is in-memory only; an id can be evicted under memory pressure, so rerun the original tool if it is gone.',
	args: '{"id": string, "offset"?: number, "limit"?: number, "search"?: string}',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'string', description: 'Cached result id returned by an oversized Rewst Buddy tool result.' },
			offset: { type: 'number', description: 'Character offset to start reading from (default 0).' },
			limit: {
				type: 'number',
				description: `Maximum characters to return (default ${DEFAULT_READ_LIMIT}, max ${MAX_READ_LIMIT}).`,
			},
			search: {
				type: 'string',
				description: 'Search text; returns matching lines with line numbers instead of a slice.',
			},
		},
		required: ['id'],
	},
};

export const resultReadCapability: Capability = {
	spec: resultReadSpec,
	group: 'result',
	access: 'read',
	chat: false,
	mcp: true,
	requiresOrg: false,
	async run(input: Record<string, unknown>, _ctx): Promise<string> {
		const id = asString(input, 'id');
		if (!id) throw new Error('buddy_result_read requires an "id" from a previous oversized Rewst Buddy result.');
		const entry = mcpResultCache.get(id);
		if (!entry) {
			throw new Error(
				`No cached Rewst Buddy result for id "${id}". The in-memory cache may have evicted it or it may be absent; rerun the original tool to regenerate it.`,
			);
		}
		const search = asString(input, 'search');
		if (search !== undefined) return searchCachedOutput(entry, search);
		const offset = clampInt(input.offset, 0, entry.text.length, 0);
		const limit = clampInt(input.limit, 1, MAX_READ_LIMIT, DEFAULT_READ_LIMIT);
		return sliceCachedOutput(entry, offset, limit);
	},
};

function sliceCachedOutput(entry: CacheEntry, offset: number, limit: number): string {
	const end = Math.min(offset + limit, entry.text.length);
	const chunk = entry.text.slice(offset, end);
	const header = `Cached result "${entry.id}" (${entry.tool}), characters ${offset}-${end} of ${entry.text.length}.`;
	const footer =
		end < entry.text.length
			? `\n...(more; continue with ${RESULT_READ_TOOL_NAME}: {"id":"${entry.id}","offset":${end}})`
			: '\n(end of result)';
	return `${header}\n\n${chunk}${footer}`;
}

function searchCachedOutput(entry: CacheEntry, query: string): string {
	const needle = query.toLowerCase();
	const hits: string[] = [];
	let matches = 0;
	let outputChars = 0;

	for (const [index, line] of entry.text.split('\n').entries()) {
		if (!line.toLowerCase().includes(needle)) continue;
		matches++;
		if (hits.length >= MAX_SEARCH_HITS) continue;
		const rendered = `${index + 1}: ${clampLine(line)}`;
		const nextChars = outputChars + rendered.length + (hits.length > 0 ? 1 : 0);
		if (nextChars > SEARCH_OUTPUT_CHARS) continue;
		hits.push(rendered);
		outputChars = nextChars;
	}

	if (matches === 0) return `No lines in cached result "${entry.id}" match "${query}".`;
	const omitted = matches - hits.length;
	const tail = omitted > 0 ? `\n...(${omitted} more matching line(s); narrow the search)` : '';
	return `${matches} matching line(s) in cached result "${entry.id}" for "${query}":\n${hits.join('\n')}${tail}`;
}

function clampLine(line: string): string {
	return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}...` : line;
}

function asString(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function _resetMcpResultCacheForTesting(): void {
	mcpResultCache.clear();
}
