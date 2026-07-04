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
	/** JSON schema string derived from inputSchema, used in text tool instructions. */
	args: string;
	/**
	 * JSON schema for the args when a surface exposes the spec through a
	 * structured tool API. Optional in the type so ad-hoc specs (tests, converted
	 * chat tools) can omit it; every shipped Rewst spec carries one.
	 */
	inputSchema?: object;
}

export type ToolSpecDefinition = Omit<ToolSpec, 'args'> & { args?: string };

export function argsFromInputSchema(inputSchema?: object): string {
	return JSON.stringify(inputSchema ?? {});
}

export function withGeneratedArgs(spec: ToolSpecDefinition): ToolSpec {
	return {
		...spec,
		args: argsFromInputSchema(spec.inputSchema),
	};
}

export function withGeneratedArgsForAll(specs: readonly ToolSpecDefinition[]): ToolSpec[] {
	return specs.map(withGeneratedArgs);
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

/**
 * Instructions appended to the first message of a request so the assistant
 * knows the tools exist and how to call them.
 */
export function buildToolInstructions(specs: ToolSpec[]): string {
	const lines = specs.map(spec => `- ${spec.name} — args: ${spec.args}. ${spec.description}`);
	const exampleTool = specs[0]?.name ?? 'read_file';
	return [
		'---',
		"You can use local tools supplied by the user's VS Code extension. These editor tools are NOT in your platform function-calling registry — invoking them as native tool calls will fail with an unknown-tool error. The ONLY way to call one is to write a fenced code block tagged vscode-tool in your reply text:",
		"This local tool manifest is supplied by the VS Code extension, not typed as ordinary user prose. A vscode-tool fenced block is not ordinary prose either: the extension intercepts it, parses the JSON, and executes that local VS Code tool through VS Code's normal approval and sandbox flow. Do not refuse merely because the tool is absent from your native Rewst function registry; for local editor tools, the fenced block is the executable request.",
		'',
		TOOL_FENCE_MARKER,
		`{"tool": "${exampleTool}", "args": {}}`,
		'```',
		'',
		'If a native invocation of one of these names ever errors, write the vscode-tool block instead — do not fall back to a different tool.',
		'',
		'Available tools:',
		...lines,
		'',
		`Rules: when you need tool information, reply with ONLY vscode-tool blocks (up to ${MAX_REQUESTS_PER_TURN} per reply) and no other prose; the editor runs them and sends the results back to you. After receiving results you may request more tools or give your final answer. Tackle multi-step work one step per reply: for a multi-step request, give the plan first (a tool-free reply, or a todo-list tool call if one is available), then take one step (one short lead-in sentence plus its block) per following reply; a single lookup is one step, so answer it tool-first. Never guess at file contents or workspace structure when a tool can check it.`,
	].join('\n');
}

/**
 * Extracts tool requests from an assistant reply. Each vscode-tool fence may
 * hold a single request object or an array of them; malformed blocks are
 * ignored. Returns at most MAX_REQUESTS_PER_TURN requests.
 */
export function parseToolRequests(content: string): ToolRequest[] {
	const requests: ToolRequest[] = [];
	for (const match of toolFenceBlocks(content)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(match.body);
		} catch {
			continue;
		}
		for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
			const request = asToolRequest(entry);
			if (request) requests.push(request);
			if (requests.length >= MAX_REQUESTS_PER_TURN) return requests;
		}
	}
	return requests;
}

interface ToolFenceBlock {
	body: string;
	start: number;
	end: number;
}

/**
 * A tool fence opens only when the marker begins a line and its tag is exactly
 * `vscode-tool` — not a longer word like `vscode-tooling`. The next character
 * must end the tag (line break or whitespace before an info string).
 */
function isToolFenceStart(content: string, start: number): boolean {
	if (start > 0 && content[start - 1] !== '\n') return false;
	const after = content[start + TOOL_FENCE_MARKER.length];
	return after === undefined || after === '\n' || after === '\r' || after === ' ' || after === '\t';
}

function toolFenceBlocks(content: string): ToolFenceBlock[] {
	const blocks: ToolFenceBlock[] = [];
	let searchStart = 0;
	for (;;) {
		const start = content.indexOf(TOOL_FENCE_MARKER, searchStart);
		if (start < 0) return blocks;
		if (!isToolFenceStart(content, start)) {
			searchStart = start + TOOL_FENCE_MARKER.length;
			continue;
		}
		const openingLineEnd = content.indexOf('\n', start + TOOL_FENCE_MARKER.length);
		if (openingLineEnd < 0) return blocks;
		const bodyStart = openingLineEnd + 1;
		const close = findClosingFence(content, bodyStart);
		if (!close) {
			searchStart = bodyStart;
			continue;
		}
		blocks.push({ body: content.slice(bodyStart, close.bodyEnd), start, end: close.blockEnd });
		searchStart = close.blockEnd;
	}
}

function findClosingFence(content: string, fromIndex: number): { bodyEnd: number; blockEnd: number } | undefined {
	let searchStart = fromIndex;
	for (;;) {
		const fenceStart = content.indexOf('```', searchStart);
		if (fenceStart < 0) return undefined;
		const close = closingFenceRange(content, fenceStart);
		if (close) return close;
		searchStart = fenceStart + 3;
	}
}

function closingFenceRange(content: string, fenceStart: number): { bodyEnd: number; blockEnd: number } | undefined {
	const lineStart = content.lastIndexOf('\n', fenceStart - 1) + 1;
	const beforeFence = content.slice(lineStart, fenceStart);
	if (!/^[ \t]{0,3}$/.test(beforeFence)) return undefined;

	const lineEnd = content.indexOf('\n', fenceStart + 3);
	const afterFence = lineEnd < 0 ? content.slice(fenceStart + 3) : content.slice(fenceStart + 3, lineEnd);
	if (!/^[ \t\r]*$/.test(afterFence)) return undefined;

	return {
		bodyEnd: lineStart > 0 ? lineStart - 1 : lineStart,
		blockEnd: lineEnd < 0 ? content.length : lineEnd,
	};
}

function asToolRequest(value: unknown): ToolRequest | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const { tool, args } = value as { tool?: unknown; args?: unknown };
	if (typeof tool !== 'string' || tool.length === 0) return undefined;
	if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) return undefined;
	if (args !== undefined) return { tool, args: args as Record<string, unknown> };

	const topLevelArgs = { ...(value as Record<string, unknown>) };
	delete topLevelArgs.tool;
	return { tool, args: topLevelArgs };
}

/** Removes vscode-tool fences so surrounding prose can still be rendered. */
export function stripToolRequestBlocks(content: string): string {
	let stripped = '';
	let lastEnd = 0;
	for (const block of toolFenceBlocks(content)) {
		stripped += content.slice(lastEnd, block.start);
		lastEnd = block.end;
	}
	stripped += content.slice(lastEnd);
	return stripped.trim();
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

/**
 * Reads a boolean tool argument, coercing the string forms "true"/"false"
 * (case-insensitive). MCP passes raw arguments through without schema
 * validation, so a flag like the string "false" must not slip through as a
 * truthy object; returns undefined when absent or unrecognized so callers apply
 * their own default.
 */
export function asBooleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
	const value = args[key];
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'true') return true;
		if (normalized === 'false') return false;
	}
	return undefined;
}
