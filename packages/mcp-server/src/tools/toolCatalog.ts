/**
 * Tool catalog: how the turn message advertises tools without blowing the
 * backend's message length limit.
 *
 * Rendering every advertised tool with its full description and JSON args schema
 * costs ~73k characters for the Buddy registry alone — more than the backend
 * accepts for one message, so the turn failed before it started. Instead the
 * manifest is planned against a character budget: tools that fit are listed in
 * full, and the rest appear as a one-line catalog entry (name + summary). The
 * assistant navigates that catalog by requesting `buddy_tool_details` for the
 * names it intends to use, which returns those tools' full description and exact
 * args schema for the next turn.
 *
 * The details tool is handled by the chat provider itself (not the capability
 * registry) so it can describe VS Code editor tools as well as Buddy tools —
 * both reach the backend only through this manifest.
 */

import { truncateToBudget } from '../utils/messageBudget';
import type { ToolSpec } from './toolProtocol';

export const TOOL_DETAILS_TOOL_NAME = 'buddy_tool_details';

/** Cap for a catalog entry's summary text. */
export const TOOL_SUMMARY_MAX_CHARS = 200;

/** Max tools one buddy_tool_details request may expand. */
export const MAX_TOOL_DETAILS_REQUESTED = 12;

const TOOL_DETAILS_INPUT_SCHEMA = {
	type: 'object',
	properties: {
		tools: {
			type: 'array',
			items: { type: 'string' },
			description: `Names of the tools to describe, from the catalog in this conversation (max ${MAX_TOOL_DETAILS_REQUESTED}).`,
		},
	},
	required: ['tools'],
} as const;

/**
 * The details tool's own spec. Always listed in full, since it is the entry point
 * to everything the catalog only summarizes.
 */
export const TOOL_DETAILS_SPEC: ToolSpec = {
	name: TOOL_DETAILS_TOOL_NAME,
	description:
		'Look up the full description and exact args schema for tools this conversation listed by summary only. Request it with the names you intend to use, read the returned schemas, then call those tools in a following reply.',
	args: JSON.stringify(TOOL_DETAILS_INPUT_SCHEMA),
	inputSchema: TOOL_DETAILS_INPUT_SCHEMA,
};

/**
 * The underlying Buddy tool name behind a VS Code MCP tool name, or undefined.
 *
 * When the user also has Rewst Buddy's `/mcp` bridge configured as an MCP server
 * in the chat, VS Code passes our own tools back to us under its MCP naming
 * (`mcp_<server>_buddy_x`). Without recognizing that, every such tool is
 * advertised twice — once prefixed from VS Code, once bare from the in-process
 * path — which wasted a fifth of the manifest and gave the model two names for
 * one operation.
 */
export function mcpToolTail(name: string): string | undefined {
	const match = /^mcp_.+?_(buddy_.+)$/.exec(name);
	return match?.[1];
}

/**
 * First sentence of a tool description, whitespace-collapsed and capped — enough
 * for the assistant to decide whether the tool is worth expanding.
 */
export function summarizeToolDescription(description: string, max = TOOL_SUMMARY_MAX_CHARS): string {
	const flat = description.replace(/\s+/g, ' ').trim();
	if (flat.length <= max) return flat;
	const sentence = flat.slice(0, max).match(/^(.*?[.!?])(?:\s|$)/);
	if (sentence?.[1]) return sentence[1].trim();
	const cut = flat.slice(0, max);
	const lastSpace = cut.lastIndexOf(' ');
	return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Full manifest line: name, exact args schema, whole description. */
export function renderToolDetailEntry(spec: ToolSpec): string {
	return `- ${spec.name} — args: ${spec.args}. ${spec.description}`;
}

/** Catalog line: name and a one-sentence summary, no schema. */
export function renderToolCatalogEntry(spec: ToolSpec): string {
	return `- ${spec.name} — ${summarizeToolDescription(spec.description)}`;
}

/** Name-only entry: the floor every advertised tool is guaranteed. */
export function renderToolNameEntry(spec: ToolSpec): string {
	return `- ${spec.name}`;
}

export interface ToolManifestPlan {
	/** Listed with full description and args schema. */
	detailed: ToolSpec[];
	/** Listed as a one-line summary; expandable via buddy_tool_details. */
	cataloged: ToolSpec[];
	/** Listed by name only; expandable via buddy_tool_details. */
	named: ToolSpec[];
}

const ENTRY_COST = (rendered: string): number => rendered.length + 1;

/**
 * Assigns each advertised spec the richest listing the budget affords, so the
 * rendered manifest fits `budget` characters and every tool stays discoverable.
 *
 * Everything fits → every tool is detailed (unchanged behavior for small tool
 * sets). Otherwise the budget is spent greedily in the order given: a spec takes
 * full detail if that still leaves every remaining spec its name-only floor,
 * else a summary, else its name. Order matters — VS Code editor tools are
 * advertised first, so with a large registry they keep their exact schemas
 * (the model calls them constantly) while the long tail degrades to summaries
 * and names it can expand on demand. Callers list `buddy_tool_details` first so
 * the catalog's own entry point is the first to earn full detail.
 *
 * `budget` bounds the rendered entries, down to the floor of listing every tool
 * by name: a tool is never dropped to satisfy the budget, since an unlisted tool
 * is an uncallable one. Callers pass a budget far above that floor, and the
 * transport clamp is the backstop.
 */
export function planToolManifest(specs: readonly ToolSpec[], budget: number): ToolManifestPlan {
	const detailChars = specs.reduce((sum, spec) => sum + ENTRY_COST(renderToolDetailEntry(spec)), 0);
	if (detailChars <= budget) return { detailed: [...specs], cataloged: [], named: [] };

	// Floor cost of everything after position i, so spending here can never starve
	// a later spec of its name entry.
	const nameCosts = specs.map(spec => ENTRY_COST(renderToolNameEntry(spec)));
	const floorAfter: number[] = new Array(specs.length + 1).fill(0);
	for (let i = specs.length - 1; i >= 0; i--) floorAfter[i] = floorAfter[i + 1] + nameCosts[i];

	const detailed: ToolSpec[] = [];
	const cataloged: ToolSpec[] = [];
	const named: ToolSpec[] = [];
	let remaining = budget;
	for (let i = 0; i < specs.length; i++) {
		const spec = specs[i];
		const rest = floorAfter[i + 1];
		const detailCost = ENTRY_COST(renderToolDetailEntry(spec));
		const catalogCost = ENTRY_COST(renderToolCatalogEntry(spec));
		if (detailCost + rest <= remaining) {
			detailed.push(spec);
			remaining -= detailCost;
		} else if (catalogCost + rest <= remaining) {
			cataloged.push(spec);
			remaining -= catalogCost;
		} else {
			named.push(spec);
			remaining -= nameCosts[i];
		}
	}
	return { detailed, cataloged, named };
}

const REFRESHER_PROTOCOL_LINE =
	'Local tool protocol reminder: the tool manifest sent earlier in this conversation still applies. Request a local tool by writing a fenced `vscode-tool` JSON block in your reply text — the extension intercepts the block and runs it through VS Code. These names are not in your native function registry; never invoke them as native Rewst function calls. When you use a tool, reply with the block(s) and at most one short lead-in sentence.';

/**
 * Comma-separated tool names within `budget`. A registry too large to name in
 * full is cut with a count of the remainder, which stays truthful about
 * availability (they are all still callable, and expandable via the details
 * lookup) while keeping the refresher a bounded cost.
 */
function renderNameList(specs: readonly ToolSpec[], budget: number): string {
	if (budget <= 0) return '';
	const tail = (kept: number): string =>
		`, and ${specs.length - kept} more (all callable; use ${TOOL_DETAILS_TOOL_NAME} for any name).`;
	const tailReserve = tail(0).length;
	const names: string[] = [];
	let spent = 0;
	for (const spec of specs) {
		const cost = spec.name.length + 2;
		if (spent + cost > Math.max(0, budget - tailReserve)) {
			// The disclosure itself has to fit, or naming nothing is the honest output.
			return truncateToBudget(`${names.join(', ')}${tail(names.length)}`, budget);
		}
		names.push(spec.name);
		spent += cost;
	}
	return `${names.join(', ')}.`;
}

/**
 * Compact stand-in for callers that already supplied the full manifest. This
 * keeps what needs recency — the protocol rules and exact names available now —
 * and points at `buddy_tool_details` for anything the manifest only summarized.
 */
export function buildToolRefresher(specs: readonly ToolSpec[], budget: number): string {
	if (specs.length === 0) return '';
	const { cataloged, named } = planToolManifest([TOOL_DETAILS_SPEC, ...specs], budget);
	const hint =
		cataloged.length + named.length > 0
			? `For a tool the manifest did not list with a full args schema, request \`${TOOL_DETAILS_TOOL_NAME}\` with its name to get its exact args before calling it.`
			: '';
	const namesLabel = 'Tools available this turn: ';
	// Everything except the name list has to be sent whole, so the names get what
	// is left of the budget after it.
	const framing = '---'.length + REFRESHER_PROTOCOL_LINE.length + namesLabel.length + hint.length + 4;
	const lines = ['---', REFRESHER_PROTOCOL_LINE, `${namesLabel}${renderNameList(specs, budget - framing)}`];
	if (hint) lines.push(hint);
	// A budget below the fixed framing cannot hold the reminder; the bound still
	// holds, so the text is cut rather than overrunning it.
	return truncateToBudget(lines.join('\n'), budget);
}

/** Fuzzy name suggestions for a details request that named an unknown tool. */
function suggestNames(name: string, specs: readonly ToolSpec[], limit = 3): string[] {
	const needle = name.toLowerCase().replace(/[^a-z0-9]/g, '');
	if (!needle) return [];
	return specs
		.map(spec => spec.name)
		.filter(candidate => {
			const haystack = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
			return haystack.includes(needle) || needle.includes(haystack);
		})
		.slice(0, limit);
}

/** Reads the `tools` argument of a details request defensively. */
export function parseRequestedToolNames(args: Record<string, unknown>): string[] {
	const raw = args.tools ?? args.names ?? args.tool ?? args.name;
	const list = Array.isArray(raw) ? raw : [raw];
	const names: string[] = [];
	for (const entry of list) {
		if (typeof entry !== 'string') continue;
		const name = entry.trim();
		if (name && !names.includes(name)) names.push(name);
		if (names.length >= MAX_TOOL_DETAILS_REQUESTED) break;
	}
	return names;
}

/**
 * Result text for a `buddy_tool_details` request: the full description and args
 * schema of each named tool. An unknown name yields an explicit line (with close
 * matches when there are any) instead of being dropped, so the assistant learns
 * the name is wrong rather than assuming the tool is unavailable.
 */
export function renderToolDetails(specs: readonly ToolSpec[], args: Record<string, unknown>): string {
	const names = parseRequestedToolNames(args);
	if (names.length === 0) {
		return 'No tool names given. Request buddy_tool_details with {"tools": ["<name>", …]} using names from the tool catalog in this conversation.';
	}
	const byName = new Map([TOOL_DETAILS_SPEC, ...specs].map(spec => [spec.name, spec]));
	const sections = names.map(name => {
		const spec = byName.get(name);
		if (!spec) {
			const suggestions = suggestNames(name, specs);
			const hint = suggestions.length > 0 ? ` Closest available names: ${suggestions.join(', ')}.` : '';
			return `### ${name}\nNot available in this conversation.${hint}`;
		}
		return `### ${spec.name}\nargs: ${spec.args}\n\n${spec.description}`;
	});
	return sections.join('\n\n');
}
