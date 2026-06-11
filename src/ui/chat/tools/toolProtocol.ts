/**
 * Client-side tool protocol for the @rewst chat participant.
 *
 * RoboRewsty's agent runs server-side and knows nothing about VS Code or the
 * user's active Rewst session, so the extension teaches it a convention:
 * instructions appended to the user's message describe local tools and ask it to
 * request them via fenced ```rewst-tool JSON blocks. The participant parses
 * those blocks out of each answer, executes the tools locally, and sends the
 * results back as the next turn of the same conversation — looping until the
 * assistant produces an answer with no tool requests.
 */

export interface ToolSpec {
	name: string;
	/** What the tool does, shown to the assistant. */
	description: string;
	/** Human-readable JSON arg signature, e.g. `{"path": string}`. */
	args: string;
}

export interface ToolRequest {
	tool: string;
	args: Record<string, unknown>;
}

/** Before/after snapshot of a file an edit tool changed. */
export interface ToolFileChange {
	uriString: string;
	before: string;
	after: string;
}

export interface ToolResult {
	tool: string;
	/** Compact echo of the request args, for labeling. */
	argsLabel: string;
	ok: boolean;
	output: string;
	/** Workspace files this tool touched (uri strings), for chat references/links. */
	fileUriStrings?: string[];
	/** Edit tools: snapshot for rendering an added/removed diff in the chat. */
	change?: ToolFileChange;
}

export const TOOL_FENCE_TAG = 'rewst-tool';
export const TOOL_FENCE_MARKER = '```' + TOOL_FENCE_TAG;

/** Hard cap on tool calls honored per assistant reply. */
export const MAX_REQUESTS_PER_TURN = 5;

// Result budgets mirror the reference-context budgets in promptContext.ts.
export const MAX_RESULT_CHARS = 8_000;
export const MAX_TOTAL_RESULT_CHARS = 24_000;

const FENCE = /```rewst-tool[^\n]*\n([\s\S]*?)```/g;

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
				'GraphQL: you have a session-authenticated GraphQL action. Use rewst_graphql_schema first when you need field names, argument names, input types, enum values, or root Query/Mutation fields; then call rewst_graphql with the final operation and variables.',
			]
		: [];
	return [
		'---',
		"You can use local tools supplied by the user's VS Code extension. To call one, reply with a fenced code block tagged rewst-tool containing JSON:",
		'',
		'```rewst-tool',
		'{"tool": "read_file", "args": {"path": "src/example.jinja"}}',
		'```',
		'',
		'Available tools:',
		...lines,
		...graphqlNote,
		'',
		`Rules: when you need tool information, reply with ONLY rewst-tool blocks (up to ${MAX_REQUESTS_PER_TURN} per reply) and no other prose; the editor runs them and sends the results back to you. After receiving results you may request more tools or give your final answer. Never guess at file contents, workspace structure, or live Rewst data when a tool can check it. Long results are cut off with a note saying how to continue (e.g. read_file startLine/endLine for the next chunk); never repeat a request you already made — identical repeats are rejected.`,
	].join('\n');
}

/**
 * Extracts tool requests from an assistant reply. Each rewst-tool fence may
 * hold a single request object or an array of them; malformed blocks are
 * ignored. Returns at most MAX_REQUESTS_PER_TURN requests.
 */
export function parseToolRequests(content: string): ToolRequest[] {
	const requests: ToolRequest[] = [];
	for (const match of content.matchAll(FENCE)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(match[1]);
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

function asToolRequest(value: unknown): ToolRequest | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const { tool, args } = value as { tool?: unknown; args?: unknown };
	if (typeof tool !== 'string' || tool.length === 0) return undefined;
	if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) return undefined;
	return { tool, args: (args as Record<string, unknown>) ?? {} };
}

/** Removes rewst-tool fences so surrounding prose can still be rendered. */
export function stripToolRequestBlocks(content: string): string {
	return content.replace(FENCE, '').trim();
}

/** One-line summary of args for progress labels and result headers. */
export function describeRequest(request: ToolRequest): string {
	const json = JSON.stringify(request.args);
	return json === '{}' ? request.tool : `${request.tool} ${json}`;
}

/** Reads a non-empty string tool argument, or undefined if absent/wrong type. */
export function asStringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads a finite number tool argument, or undefined if absent/wrong type. */
export function asNumberArg(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const EDIT_TOOL_NAMES = new Set(['edit_file', 'write_file']);

/**
 * Guards the tool loop against cycles: duplicate requests within one reply
 * are dropped, and a request identical to one already executed in an earlier
 * round is blocked with a nudge instead of re-run — unless a file edit
 * happened since (the workspace may have changed). Edit tools are never
 * blocked; repeating an identical edit fails naturally ("find" won't match).
 */
export class RequestDeduper {
	private executed = new Map<string, number>();
	private lastEditRound = -1;

	filter(requests: ToolRequest[], round: number): { run: ToolRequest[]; blocked: ToolRequest[] } {
		const run: ToolRequest[] = [];
		const blocked: ToolRequest[] = [];
		const seenThisReply = new Set<string>();

		for (const request of requests) {
			const signature = `${request.tool}:${JSON.stringify(request.args)}`;
			if (seenThisReply.has(signature)) continue;
			seenThisReply.add(signature);

			const priorRound = this.executed.get(signature);
			const repeat = priorRound !== undefined && this.lastEditRound < priorRound;
			if (repeat && !EDIT_TOOL_NAMES.has(request.tool)) {
				blocked.push(request);
				continue;
			}
			this.executed.set(signature, round);
			run.push(request);
		}

		if (run.some(request => EDIT_TOOL_NAMES.has(request.tool))) this.lastEditRound = round;
		return { run, blocked };
	}
}

/** The nudge sent back for a blocked repeat, instead of re-running the tool. */
export function blockedRepeatResult(request: ToolRequest): ToolResult {
	const argsLabel = JSON.stringify(request.args) === '{}' ? '' : JSON.stringify(request.args);
	return {
		tool: request.tool,
		argsLabel,
		ok: false,
		output:
			'You already ran this exact request and received its result. Do not repeat identical calls — ' +
			'request a specific line range or a different file, or stop and give your final answer based on what you have.',
	};
}

/**
 * Builds the follow-up message carrying tool outputs back to the assistant.
 * Applies per-result and total budgets so a huge file can't blow the turn.
 */
export function formatToolResults(results: ToolResult[]): string {
	const sections: string[] = ['Tool results:'];
	let total = 0;
	for (const result of results) {
		const budget = Math.min(MAX_RESULT_CHARS, Math.max(0, MAX_TOTAL_RESULT_CHARS - total));
		let output = result.output;
		const truncated = output.length > budget;
		if (truncated) output = output.slice(0, budget);
		total += output.length;

		const status = result.ok ? '' : ' (error)';
		const note = truncated ? '\n…(truncated)' : '';
		const label = result.argsLabel ? `${result.tool} ${result.argsLabel}` : result.tool;
		sections.push(`### ${label}${status}\n\`\`\`\n${output}${note}\n\`\`\``);
	}
	sections.push('Reply with more rewst-tool blocks if you need anything else, or give your final answer.');
	return sections.join('\n\n');
}
