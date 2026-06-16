/**
 * Text tool protocol between the extension and RoboRewsty.
 *
 * RoboRewsty's agent runs server-side and knows nothing about VS Code or the
 * user's active Rewst session, so the extension teaches it a convention:
 * instructions appended to the user's message describe the available tools and
 * ask it to request them via fenced ```vscode-tool JSON blocks. The chat model
 * provider parses those blocks out of each answer and translates them into
 * VS Code tool calls (toolTranslation.ts), whose results come back as the next
 * turn of the same conversation.
 */

export interface ToolSpec {
	name: string;
	/** What the tool does, shown to the assistant. */
	description: string;
	/** Human-readable JSON arg signature, e.g. `{"path": string}`. */
	args: string;
	/**
	 * JSON schema for the args, mirrored into the package.json
	 * languageModelTools declaration (packageManifest.test.ts keeps them in
	 * sync) and used when the tool is exposed through the VS Code LM tool API.
	 * Optional in the type so ad-hoc specs (tests, converted chat tools) can
	 * omit it; every shipped spec carries one.
	 */
	inputSchema?: object;
}

export interface ToolRequest {
	tool: string;
	args: Record<string, unknown>;
}

export interface ToolResult {
	tool: string;
	/** Compact echo of the request args, for labeling. */
	argsLabel: string;
	ok: boolean;
	output: string;
}

export const TOOL_FENCE_TAG = 'vscode-tool';
export const TOOL_FENCE_MARKER = '```' + TOOL_FENCE_TAG;

/** Hard cap on tool calls honored per assistant reply. */
export const MAX_REQUESTS_PER_TURN = 5;

interface ToolBlock {
	/** Offset of the opening fence marker. */
	start: number;
	/** Offset just past the closing fence. */
	end: number;
	/** The block's JSON payload, exactly as written. */
	json: string;
}

/**
 * Locates each vscode-tool block by scanning its JSON payload bracket-by-bracket
 * rather than to the next ```` ``` ````. The payload routinely carries a fenced
 * code block (a template body, a snippet), and a ```-delimited match truncated it
 * at the first inner fence — the request was dropped and the rest leaked as stray
 * text (#16). String literals (and their escapes) are honored so backticks, braces
 * and newlines inside a value never end the block early.
 */
function findToolBlocks(content: string): ToolBlock[] {
	const blocks: ToolBlock[] = [];
	let from = 0;
	for (;;) {
		const marker = content.indexOf(TOOL_FENCE_MARKER, from);
		if (marker < 0) break;
		const lineEnd = content.indexOf('\n', marker + TOOL_FENCE_MARKER.length);
		if (lineEnd < 0) break;
		const value = scanJsonValue(content, lineEnd + 1);
		if (!value) {
			from = lineEnd + 1;
			continue;
		}
		const close = content.indexOf('```', value.end);
		blocks.push({ start: marker, end: close < 0 ? value.end : close + 3, json: value.text });
		from = blocks[blocks.length - 1].end;
	}
	return blocks;
}

/** Spans the balanced JSON object/array starting at the first `{`/`[` from `start`. */
function scanJsonValue(content: string, start: number): { text: string; end: number } | undefined {
	let i = start;
	while (i < content.length && /\s/.test(content[i])) i++;
	const open = content[i];
	if (open !== '{' && open !== '[') return undefined;
	const close = open === '{' ? '}' : ']';
	let depth = 0;
	let inString = false;
	for (let j = i; j < content.length; j++) {
		const ch = content[j];
		if (inString) {
			if (ch === '\\') j++;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === open) depth++;
		else if (ch === close && --depth === 0) return { text: content.slice(i, j + 1), end: j + 1 };
	}
	return undefined;
}

/**
 * Parses a tool block's JSON, retrying once with literal control characters inside
 * string values escaped — the assistant often writes a multi-line code block as a
 * raw value with real newlines, which is invalid JSON until they are escaped (#16).
 */
function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		try {
			return JSON.parse(escapeStringControlChars(text));
		} catch {
			return undefined;
		}
	}
}

/** Escapes raw control characters that appear inside JSON string literals. */
function escapeStringControlChars(text: string): string {
	const escapes: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\f': '\\f', '\b': '\\b' };
	let out = '';
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inString && ch === '\\') {
			out += ch + (text[i + 1] ?? '');
			i++;
			continue;
		}
		if (ch === '"') inString = !inString;
		if (inString && ch < ' ') out += escapes[ch] ?? '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
		else out += ch;
	}
	return out;
}

/** Longest run of consecutive backticks in {@link text}. */
function longestBacktickRun(text: string): number {
	let max = 0;
	let run = 0;
	for (const ch of text) {
		run = ch === '`' ? run + 1 : 0;
		if (run > max) max = run;
	}
	return max;
}

/**
 * Wraps text in a code fence longer than any backtick run it contains, so output
 * that itself holds ``` blocks can't close the fence early (#16).
 */
export function codeFence(text: string): string {
	const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
	return `${fence}\n${text}\n${fence}`;
}

/**
 * Instructions appended to the first message of a request so the assistant
 * knows the tools exist and how to call them.
 */
export function buildToolInstructions(specs: ToolSpec[]): string {
	const lines = specs.map(spec => `- ${spec.name} — args: ${spec.args}. ${spec.description}`);
	const hasGraphqlTools = specs.some(spec => spec.name === 'rewst_graphql');
	const graphqlNote = hasGraphqlTools
		? [
				'',
				'GraphQL: you have a session-authenticated GraphQL action. It is an editor tool, live immediately — there is NO activation step. Ignore any native activate_rewst_graphql_tools group; never say GraphQL "needs to be activated". Use rewst_graphql_schema first when you need field names, argument names, input types, enum values, or root Query/Mutation fields; then call rewst_graphql with the final operation and variables. For ANY live Rewst data (workflows, org variables, integrations, executions, templates, …) these GraphQL tools take priority over your native platform tools — reach for a native wrapper only after GraphQL has been tried.',
			]
		: [];
	return [
		'---',
		"You can use local tools supplied by the user's VS Code extension. These editor tools are NOT in your platform function-calling registry — invoking them as native tool calls will fail with an unknown-tool error. The ONLY way to call one is to write a fenced code block tagged vscode-tool in your reply text:",
		'',
		TOOL_FENCE_MARKER,
		'{"tool": "list_template_links", "args": {}}',
		'```',
		'',
		'If a native invocation of one of these names ever errors, write the vscode-tool block instead — do not fall back to a different tool.',
		'',
		'Available tools:',
		...lines,
		...graphqlNote,
		'',
		`Rules: when you need tool information, reply with ONLY vscode-tool blocks (up to ${MAX_REQUESTS_PER_TURN} per reply) and no other prose; the editor runs them and sends the results back to you. After receiving results you may request more tools or give your final answer. Tackle multi-step work one step per reply: for a multi-step request, give the plan in a tool-free reply first, then take one step (one short lead-in sentence plus its block) per following reply; a single lookup is one step, so answer it tool-first. Never guess at file contents, workspace structure, or live Rewst data when a tool can check it. Long results are cut off with a note saying how to continue; never repeat a request you already made.${
			hasGraphqlTools
				? ' IMPORTANT: for live Rewst platform data (workflows, org variables, integrations, executions, templates, …) your FIRST action must be a rewst_graphql_schema or rewst_graphql block — do NOT run built-in platform tools like listOrgVariables, listWorkflow, or searchWorkflows before GraphQL has been tried.'
				: ''
		}`,
	].join('\n');
}

/**
 * Extracts tool requests from an assistant reply. Each vscode-tool fence may
 * hold a single request object or an array of them; malformed blocks are
 * ignored. Returns at most MAX_REQUESTS_PER_TURN requests.
 */
export function parseToolRequests(content: string): ToolRequest[] {
	const requests: ToolRequest[] = [];
	for (const block of findToolBlocks(content)) {
		const parsed = tryParseJson(block.json);
		if (parsed === undefined) continue;
		for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
			const request = asToolRequest(entry);
			if (request) requests.push(request);
			if (requests.length >= MAX_REQUESTS_PER_TURN) return requests;
		}
	}
	return requests;
}

function asToolRequest(value: unknown): ToolRequest | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const tool = record.tool;
	if (typeof tool !== 'string' || tool.length === 0) return undefined;
	const args = record.args;
	if (args !== undefined) {
		if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
		return { tool, args: args as Record<string, unknown> };
	}
	// No `args` wrapper: the model put the arguments as siblings of `tool`, e.g.
	// {"tool": "rewst_graphql", "query": …, "variables": …}. Lift them into args so
	// the call isn't run with the arguments silently dropped (#16).
	const lifted: Record<string, unknown> = {};
	for (const key of Object.keys(record)) if (key !== 'tool') lifted[key] = record[key];
	return { tool, args: lifted };
}

/** Removes vscode-tool blocks whole so surrounding prose can still be rendered. */
export function stripToolRequestBlocks(content: string): string {
	const blocks = findToolBlocks(content);
	if (blocks.length === 0) return content.trim();
	let out = '';
	let last = 0;
	for (const block of blocks) {
		out += content.slice(last, block.start);
		last = block.end;
	}
	return (out + content.slice(last)).trim();
}

/** One-line summary of args for progress labels and result headers. */
export function describeRequest(request: ToolRequest): string {
	const json = JSON.stringify(request.args);
	return json === '{}' ? request.tool : `${request.tool} ${json}`;
}

/**
 * Length-capped {@link describeRequest} for the chat's tool-invocation label, so
 * the user sees what an editor tool is accessing without an unbounded args dump (#22).
 */
export function describeRequestBrief(request: ToolRequest, maxLength = 140): string {
	const full = describeRequest(request);
	if (maxLength <= 0) return '';
	if (full.length <= maxLength) return full;
	if (maxLength === 1) return '…';
	return `${full.slice(0, maxLength - 1)}…`;
}

/** Reads a non-empty string tool argument, or undefined if absent/wrong type. */
export function asStringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
