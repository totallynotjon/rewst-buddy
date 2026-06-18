import { randomUUID } from 'crypto';
import { extPrefix } from '@global';
import vscode from 'vscode';
import { asStringArg, type ToolRequest, type ToolSpec } from './toolProtocol';

/**
 * In-memory store for oversized AI tool output. Nothing is written to disk:
 * when a tool returns more than {@link MAX_INLINE_OUTPUT_CHARS}, the full text
 * is kept here under a short id and the assistant receives a preview plus that
 * id. It then pages or searches the full result with the buddy_result_read
 * tool. The cache is bounded by a configurable byte budget and evicts the
 * oldest entries first; it lives only for the extension process, so there is
 * nothing to clean up and no live Rewst data ever lands in the workspace.
 */

const MAX_INLINE_OUTPUT_CHARS = 8_000;
const PREVIEW_CHARS = 8_000;
const DEFAULT_READ_LIMIT = 6_000;
const MAX_READ_LIMIT = 8_000;
const MAX_SEARCH_HITS = 50;
const SEARCH_OUTPUT_CHARS = 6_000;
const MAX_LINE_CHARS = 500;
const DEFAULT_CACHE_LIMIT_MB = 500;

export const RESULT_READ_TOOL_NAME = 'buddy_result_read';

interface CacheEntry {
	id: string;
	tool: string;
	text: string;
	bytes: number;
	at: number;
}

type StoreResult = { id: string } | { tooLarge: true; bytes: number };

/** The configured cache budget in bytes, read from settings (default 500 MB). */
function defaultCacheLimitBytes(): number {
	const mb = vscode.workspace
		.getConfiguration(`${extPrefix}.ai`)
		.get<number>('toolResultCacheLimitMB', DEFAULT_CACHE_LIMIT_MB);
	const valid = typeof mb === 'number' && Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_CACHE_LIMIT_MB;
	return Math.floor(valid * 1024 * 1024);
}

/**
 * A size-bounded, insertion-ordered map of full tool outputs. The byte budget
 * is resolved per store() so a settings change takes effect immediately;
 * oldest entries are evicted until a new entry fits.
 */
export class ToolOutputCache {
	private entries = new Map<string, CacheEntry>();
	private totalBytes = 0;

	constructor(private readonly limitBytes: () => number = defaultCacheLimitBytes) {}

	store(tool: string, text: string): StoreResult {
		const bytes = Buffer.byteLength(text, 'utf8');
		const limit = this.limitBytes();
		if (bytes > limit) return { tooLarge: true, bytes };
		while (this.totalBytes + bytes > limit && this.entries.size > 0) this.evictOldest();
		const id = this.freshId();
		this.entries.set(id, { id, tool, text, bytes, at: Date.now() });
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

/** Process-wide cache shared by every tool's output formatting. */
export const toolOutputCache = new ToolOutputCache();

/**
 * Returns the text inline when small enough; otherwise stashes the full result
 * in {@link cache} and returns a preview plus the id and read instructions.
 * The read tool's own output is passed through untouched so paging never
 * re-caches itself.
 */
export function formatToolOutput(toolName: string, text: string, cache: ToolOutputCache = toolOutputCache): string {
	if (toolName === RESULT_READ_TOOL_NAME) return text;
	if (text.length <= MAX_INLINE_OUTPUT_CHARS) return text;
	const preview = text.slice(0, PREVIEW_CHARS);
	const bytes = Buffer.byteLength(text, 'utf8');
	const stored = cache.store(toolName, text);
	if ('tooLarge' in stored) {
		return (
			`${preview}\n...(output truncated at ${PREVIEW_CHARS} characters; the full ${formatBytes(stored.bytes)} ` +
			'result exceeds the in-memory tool-result cache limit — raise rewst-buddy.ai.toolResultCacheLimitMB or narrow the request)'
		);
	}
	return [
		`Tool output was ${formatBytes(bytes)} (${text.length} characters); the full result is cached in memory as id "${stored.id}".`,
		`Read more from it with a vscode-tool block — page through it: {"tool":"buddy_result_read","args":{"id":"${stored.id}","offset":${PREVIEW_CHARS}}}, or search within it: {"tool":"buddy_result_read","args":{"id":"${stored.id}","search":"<text>"}}.`,
		'',
		'Preview (start of the full result):',
		preview,
		'...(preview truncated)',
	].join('\n');
}

export function isResultReadTool(name: string): boolean {
	return name === RESULT_READ_TOOL_NAME;
}

/** Pages through or searches a cached oversized tool result by id. */
export function runResultReadTool(request: ToolRequest, cache: ToolOutputCache = toolOutputCache): string {
	const id = asStringArg(request.args, 'id');
	if (!id) throw new Error('buddy_result_read needs an "id" from a previous oversized tool result.');
	const entry = cache.get(id);
	if (!entry) {
		throw new Error(
			`No cached tool result for id "${id}". The in-memory cache may have evicted it; rerun the original tool to regenerate it.`,
		);
	}
	const search = asStringArg(request.args, 'search');
	if (search !== undefined) return searchCachedOutput(entry, search);
	const offset = clampInt(request.args.offset, 0, entry.text.length, 0);
	const limit = clampInt(request.args.limit, 1, MAX_READ_LIMIT, DEFAULT_READ_LIMIT);
	return sliceCachedOutput(entry, offset, limit);
}

function sliceCachedOutput(entry: CacheEntry, offset: number, limit: number): string {
	const end = Math.min(offset + limit, entry.text.length);
	const chunk = entry.text.slice(offset, end);
	const header = `Cached result "${entry.id}" (${entry.tool}), characters ${offset}–${end} of ${entry.text.length}.`;
	const more =
		end < entry.text.length
			? `\n...(more — continue with {"tool":"buddy_result_read","args":{"id":"${entry.id}","offset":${end}}})`
			: '\n(end of result)';
	return `${header}\n\n${chunk}${more}`;
}

function searchCachedOutput(entry: CacheEntry, query: string): string {
	const needle = query.toLowerCase();
	const lines = entry.text.split('\n');
	const hits: string[] = [];
	let matches = 0;
	let hitChars = 0;
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].toLowerCase().includes(needle)) continue;
		matches++;
		if (hits.length >= MAX_SEARCH_HITS || hitChars >= SEARCH_OUTPUT_CHARS) continue;
		const line = `${i + 1}: ${clampLine(lines[i])}`;
		hits.push(line);
		hitChars += line.length;
	}
	if (matches === 0) return `No lines in cached result "${entry.id}" match "${query}".`;
	const omitted = matches - hits.length;
	const tail = omitted > 0 ? `\n...(${omitted} more matching line(s); narrow the search)` : '';
	return `${matches} matching line(s) in cached result "${entry.id}" for "${query}":\n${hits.join('\n')}${tail}`;
}

function clampLine(line: string): string {
	return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
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

export const RESULT_READ_TOOL_SPECS: ToolSpec[] = [
	{
		name: RESULT_READ_TOOL_NAME,
		description:
			'Read more of an oversized Rewst Buddy tool result that was cached in memory. When a tool result is too large to return inline, Rewst Buddy returns a preview plus a short id; pass that id here to page through the full text (offset/limit) or to find lines within it (search). The cache is in-memory only and is never written to disk, so an id can be evicted under memory pressure — if it is gone, rerun the original tool.',
		args: '{"id": string, "offset"?: number, "limit"?: number, "search"?: string}',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'The cached-result id from an oversized tool result.' },
				offset: { type: 'number', description: 'Character offset to start reading from (default 0).' },
				limit: {
					type: 'number',
					description: `Maximum characters to return in a slice (default ${DEFAULT_READ_LIMIT}).`,
				},
				search: {
					type: 'string',
					description: 'If set, return matching lines with line numbers instead of a slice.',
				},
			},
			required: ['id'],
		},
	},
];
