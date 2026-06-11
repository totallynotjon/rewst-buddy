import { extPrefix } from '@global';
import vscode from 'vscode';
import type { ToolRequest, ToolSpec } from './toolProtocol';

/**
 * Web tools for the rewst-tool protocol. The Rewst AI assistant has no
 * internet access of its own beyond Rewst's documentation search, so these
 * let it search the public web and read pages — executed by the extension.
 *
 * Off by default (rewst-buddy.ai.enableWebTools): the assistant chooses the
 * URLs, so enabling this lets a remote model direct local network requests.
 * Mitigations: http(s) only, private/loopback hosts rejected, redirects
 * re-validated hop by hop, responses size-capped.
 */

const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_CHARS = 8_000;
const MAX_SEARCH_RESULTS = 8;
const MAX_REDIRECTS = 5;

export const WEB_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'web_search',
		args: '{"query": string}',
		description: 'Search the public web; returns result titles, URLs, and snippets.',
	},
	{
		name: 'fetch_url',
		args: '{"url": string}',
		description: 'Fetch a public http(s) URL and return its readable text content.',
	},
];

const WEB_TOOL_NAMES = new Set(WEB_TOOL_SPECS.map(spec => spec.name));

export function isWebTool(name: string): boolean {
	return WEB_TOOL_NAMES.has(name);
}

export interface WebToolDeps {
	isEnabled(): boolean;
	/** Fetches a pre-validated URL without following redirects. */
	fetchRaw(url: string): Promise<{ status: number; location?: string; body: string }>;
}

export const defaultWebDeps: WebToolDeps = {
	isEnabled: () => vscode.workspace.getConfiguration(`${extPrefix}.ai`).get<boolean>('enableWebTools', false),
	fetchRaw: async url => {
		const response = await fetch(url, {
			redirect: 'manual',
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: { 'user-agent': 'rewst-buddy-vscode-extension', accept: 'text/html,text/plain,*/*' },
		});
		return {
			status: response.status,
			location: response.headers.get('location') ?? undefined,
			body: response.status >= 300 && response.status < 400 ? '' : await response.text(),
		};
	},
};

/** Validates an assistant-supplied URL: http(s) only, no private/loopback hosts. */
export function assertPublicHttpUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`Not a valid URL: ${raw}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Only http(s) URLs are allowed, got ${url.protocol}`);
	}
	const host = url.hostname.toLowerCase();
	const privateHost =
		host === 'localhost' ||
		host === '0.0.0.0' ||
		host === '::1' ||
		host === '[::1]' ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^169\.254\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
		/^f[cd][0-9a-f]{2}:/i.test(host) ||
		/^\[?fe80:/i.test(host);
	if (privateHost) {
		throw new Error(`Refusing to fetch private/loopback host: ${host}`);
	}
	return url;
}

async function fetchValidated(rawUrl: string, deps: WebToolDeps): Promise<string> {
	let url = assertPublicHttpUrl(rawUrl);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const result = await deps.fetchRaw(url.toString());
		if (result.status >= 300 && result.status < 400 && result.location) {
			url = assertPublicHttpUrl(new URL(result.location, url).toString());
			continue;
		}
		if (result.status >= 400) throw new Error(`HTTP ${result.status} for ${url}`);
		return result.body;
	}
	throw new Error(`Too many redirects fetching ${rawUrl}`);
}

const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#x27;': "'",
	'&#39;': "'",
	'&nbsp;': ' ',
};

/** Crude HTML → readable text: drops script/style/tags, decodes common entities. */
export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&[a-z0-9#x]+;/gi, entity => ENTITIES[entity.toLowerCase()] ?? ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.trim();
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

/**
 * Parses DuckDuckGo's HTML results page. Result links are redirect URLs with
 * the destination in the uddg query parameter.
 */
export function parseDuckDuckGoResults(html: string): SearchResult[] {
	const results: SearchResult[] = [];
	const anchors = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
	const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/g)];

	for (let i = 0; i < anchors.length && results.length < MAX_SEARCH_RESULTS; i++) {
		const [, href, titleHtml] = anchors[i];
		const uddg = /[?&]uddg=([^&"]+)/.exec(href);
		let url = uddg ? decodeURIComponent(uddg[1]) : href;
		if (url.startsWith('//')) url = 'https:' + url;
		const title = htmlToText(titleHtml);
		if (!title || !/^https?:\/\//.test(url)) continue;
		results.push({ title, url, snippet: htmlToText(snippets[i]?.[1] ?? '') });
	}
	return results;
}

function asStringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function runWebTool(request: ToolRequest, deps: WebToolDeps = defaultWebDeps): Promise<string> {
	if (!deps.isEnabled()) {
		throw new Error(
			'Web tools are disabled. The user can enable them with the rewst-buddy.ai.enableWebTools setting.',
		);
	}

	switch (request.tool) {
		case 'web_search': {
			const query = asStringArg(request.args, 'query');
			if (!query) throw new Error('web_search requires a "query" argument.');
			const html = await fetchValidated(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, deps);
			const results = parseDuckDuckGoResults(html);
			if (results.length === 0) return `No results for "${query}".`;
			return results.map(r => `${r.title}\n${r.url}${r.snippet ? `\n${r.snippet}` : ''}`).join('\n\n');
		}
		case 'fetch_url': {
			const url = asStringArg(request.args, 'url');
			if (!url) throw new Error('fetch_url requires a "url" argument.');
			const text = htmlToText(await fetchValidated(url, deps));
			return text.length > MAX_PAGE_CHARS ? text.slice(0, MAX_PAGE_CHARS) + '\n…(truncated)' : text;
		}
		default:
			throw new Error(`Unknown web tool "${request.tool}".`);
	}
}
