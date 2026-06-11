/**
 * Text tool protocol between the extension and RoboRewsty.
 *
 * RoboRewsty's agent runs server-side and knows nothing about VS Code or the
 * user's active Rewst session, so the extension teaches it a convention:
 * instructions appended to the user's message describe the available tools and
 * ask it to request them via fenced ```rewst-tool JSON blocks. The chat model
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

export const TOOL_FENCE_TAG = 'rewst-tool';
export const TOOL_FENCE_MARKER = '```' + TOOL_FENCE_TAG;

/** Hard cap on tool calls honored per assistant reply. */
export const MAX_REQUESTS_PER_TURN = 5;

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
				'GraphQL: you have a session-authenticated GraphQL action. It is an editor tool, live immediately — there is NO activation step. Ignore any native activate_rewst_graphql_tools group; never say GraphQL "needs to be activated". Use rewst_graphql_schema first when you need field names, argument names, input types, enum values, or root Query/Mutation fields; then call rewst_graphql with the final operation and variables. For ANY live Rewst data (workflows, org variables, integrations, executions, templates, …) these GraphQL tools take priority over your native platform tools — reach for a native wrapper only after GraphQL has been tried.',
			]
		: [];
	return [
		'---',
		"You can use local tools supplied by the user's VS Code extension. These editor tools are NOT in your platform function-calling registry — invoking them as native tool calls will fail with an unknown-tool error. The ONLY way to call one is to write a fenced code block tagged rewst-tool in your reply text:",
		'',
		'```rewst-tool',
		'{"tool": "list_template_links", "args": {}}',
		'```',
		'',
		'If a native invocation of one of these names ever errors, write the rewst-tool block instead — do not fall back to a different tool.',
		'',
		'Available tools:',
		...lines,
		...graphqlNote,
		'',
		`Rules: when you need tool information, reply with ONLY rewst-tool blocks (up to ${MAX_REQUESTS_PER_TURN} per reply) and no other prose; the editor runs them and sends the results back to you. After receiving results you may request more tools or give your final answer. Tackle multi-step work one step per reply: for a multi-step request, give the plan in a tool-free reply first, then take one step (one short lead-in sentence plus its block) per following reply; a single lookup is one step, so answer it tool-first. Never guess at file contents, workspace structure, or live Rewst data when a tool can check it. Long results are cut off with a note saying how to continue; never repeat a request you already made.${
			hasGraphqlTools
				? ' IMPORTANT: for live Rewst platform data (workflows, org variables, integrations, executions, templates, …) your FIRST action must be a rewst_graphql_schema or rewst_graphql block — do NOT run built-in platform tools like listOrgVariables, listWorkflow, or searchWorkflows before GraphQL has been tried.'
				: ''
		}`,
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
