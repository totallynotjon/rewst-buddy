/**
 * Anthropic Messages API wire types, request parsing, transcript serialization,
 * tool conversion, completion mapping, and id/token helpers.
 *
 * Pure module — no vscode imports anywhere in the transitive import graph.
 * Import tool protocol relatively (never via @ui barrel).
 */
import crypto from 'crypto';
import {
	buildToolInstructions,
	parseToolRequests,
	stripToolRequestBlocks,
	type ToolSpec,
} from '../../ui/chat/tools/toolProtocol';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AnthropicTextBlock {
	type: 'text';
	text: string;
}

export interface AnthropicToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface AnthropicToolDef {
	name: string;
	description?: string;
	input_schema?: object;
}

/**
 * Normalized Anthropic request. `messages` entries carry pre-serialized `parts`
 * (one string per content block, already converted from the raw block types).
 */
export interface AnthropicRequest {
	model: string;
	/** Normalized: array-of-text-blocks joined with '\n\n', or undefined */
	system?: string;
	/** Pre-serialized entries */
	messages: { role: 'user' | 'assistant'; parts: string[] }[];
	/** [] when absent */
	tools: AnthropicToolDef[];
	/** false when absent */
	stream: boolean;
}

export interface ParseFailure {
	error: string;
}

export interface Completion {
	text: string;
	toolUses: AnthropicToolUseBlock[];
	stopReason: 'end_turn' | 'tool_use';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_ENTRY_CHARS = 24_000;
export const MAX_TOTAL_CHARS = 360_000;

// ---------------------------------------------------------------------------
// parseAnthropicRequest
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parses and normalizes an Anthropic Messages API request body.
 * Returns ParseFailure on any validation error.
 */
export function parseAnthropicRequest(body: unknown): AnthropicRequest | ParseFailure {
	if (!isPlainObject(body)) {
		return { error: 'Request body must be a JSON object' };
	}

	// model
	if (typeof body.model !== 'string' || body.model.length === 0) {
		return { error: 'model must be a non-empty string' };
	}

	// messages
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		return { error: 'messages must be a non-empty array' };
	}

	// Build tool_use id→name map across ALL assistant messages first
	const toolUseIdToName = new Map<string, string>();
	for (const msg of body.messages) {
		if (!isPlainObject(msg)) continue;
		if (msg.role !== 'assistant') continue;
		const content = msg.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (isPlainObject(block) && block.type === 'tool_use') {
				if (typeof block.id === 'string' && typeof block.name === 'string') {
					toolUseIdToName.set(block.id, block.name);
				}
			}
		}
	}

	// Parse messages
	const messages: AnthropicRequest['messages'] = [];
	for (let i = 0; i < body.messages.length; i++) {
		const msg = body.messages[i];
		if (!isPlainObject(msg)) {
			return { error: `messages[${i}] must be an object` };
		}
		if (msg.role !== 'user' && msg.role !== 'assistant') {
			return { error: `messages[${i}].role must be 'user' or 'assistant', got '${String(msg.role)}'` };
		}
		if (msg.content === undefined || msg.content === null) {
			return { error: `messages[${i}].content is missing` };
		}
		const partsResult = serializeContent(msg.content, toolUseIdToName, i);
		if ('error' in partsResult) return partsResult;
		messages.push({ role: msg.role as 'user' | 'assistant', parts: partsResult.parts });
	}

	// system
	let system: string | undefined;
	if (body.system !== undefined) {
		if (typeof body.system === 'string') {
			system = body.system;
		} else if (Array.isArray(body.system)) {
			const texts: string[] = [];
			for (const block of body.system) {
				if (!isPlainObject(block) || block.type !== 'text' || typeof block.text !== 'string') {
					return { error: 'system array must contain only {type:"text", text:string} blocks' };
				}
				texts.push(block.text);
			}
			system = texts.join('\n\n');
		} else {
			return { error: 'system must be a string or an array of text blocks' };
		}
	}

	// tools
	const tools: AnthropicToolDef[] = [];
	if (body.tools !== undefined) {
		if (!Array.isArray(body.tools)) {
			return { error: 'tools must be an array' };
		}
		for (let i = 0; i < body.tools.length; i++) {
			const t = body.tools[i];
			if (!isPlainObject(t) || typeof t.name !== 'string' || t.name.length === 0) {
				return { error: `tools[${i}] must be an object with a non-empty string name` };
			}
			tools.push({
				name: t.name,
				description: typeof t.description === 'string' ? t.description : '',
				input_schema: isPlainObject(t.input_schema) ? (t.input_schema as object) : undefined,
			});
		}
	}

	// stream: true only when literally true
	const stream = body.stream === true;

	return { model: body.model, system, messages, tools, stream };
}

function serializeContent(
	content: unknown,
	toolUseIdToName: Map<string, string>,
	msgIndex: number,
): { parts: string[] } | ParseFailure {
	if (typeof content === 'string') {
		return { parts: [content] };
	}
	if (!Array.isArray(content)) {
		return { error: `messages[${msgIndex}].content must be a string or array` };
	}
	const parts: string[] = [];
	for (const block of content) {
		if (!isPlainObject(block)) {
			return { error: `messages[${msgIndex}].content contains a non-object block` };
		}
		const part = serializeBlock(block, toolUseIdToName);
		if (part !== null) parts.push(part);
	}
	return { parts };
}

function serializeBlock(block: Record<string, unknown>, toolUseIdToName: Map<string, string>): string | null {
	switch (block.type) {
		case 'text':
			return typeof block.text === 'string' ? block.text : '';

		case 'tool_use': {
			const name = typeof block.name === 'string' ? block.name : 'tool';
			const input = isPlainObject(block.input) ? block.input : {};
			return `Requested editor tool: ${name} ${JSON.stringify(input)}`;
		}

		case 'tool_result': {
			const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
			const name = toolUseIdToName.get(toolUseId) ?? 'tool';
			const isError = block.is_error === true;
			const text = extractToolResultText(block.content);
			return `Editor tool result: ${name}${isError ? ' (error)' : ''}\n${text}`;
		}

		case 'thinking':
		case 'redacted_thinking':
			// Dropped
			return null;

		default:
			return '[non-text content omitted]';
	}
}

function extractToolResultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.filter((b): b is Record<string, unknown> => isPlainObject(b) && b.type === 'text')
			.map(b => (typeof b.text === 'string' ? b.text : ''))
			.join('');
	}
	return '';
}

// ---------------------------------------------------------------------------
// buildBackendMessage
// ---------------------------------------------------------------------------

/**
 * Serializes the normalized request into a single backend message string.
 */
export function buildBackendMessage(request: AnthropicRequest): string {
	const { system, messages, tools } = request;

	// Build raw entries
	const rawEntries: string[] = [];
	if (system) {
		rawEntries.push(`SYSTEM:\n${system}`);
	}
	for (const msg of messages) {
		const joined = msg.parts.join('\n');
		if (!joined) continue; // skip empty
		const role = msg.role === 'user' ? 'USER' : 'ASSISTANT';
		rawEntries.push(`${role}: ${joined}`);
	}

	// Truncate oversized entries
	const entries = rawEntries.map(e =>
		e.length > MAX_ENTRY_CHARS ? e.slice(0, MAX_ENTRY_CHARS) + ' ...(truncated)' : e,
	);

	// Drop oldest non-SYSTEM entries while total exceeds cap
	let omitted = 0;
	const systemIdx = system ? 0 : -1;
	while (entries.length > 1) {
		const total = entries.reduce((s, e) => s + e.length, 0);
		if (total <= MAX_TOTAL_CHARS) break;
		// Find oldest droppable entry (not SYSTEM, not last)
		const dropIdx = systemIdx === 0 ? 1 : 0;
		if (dropIdx >= entries.length - 1) break; // only last remains
		entries.splice(dropIdx, 1);
		omitted++;
	}

	const omittedNote = omitted > 0 ? `(${omitted} earlier message(s) omitted)\n\n` : '';
	const transcript = [
		'<conversation_transcript>',
		`You are completing the next assistant turn of this conversation, relayed from a local`,
		`Anthropic-API-compatible client. Treat this transcript as the authoritative context and reply`,
		`with the next assistant turn only — no role labels, no commentary about the transcript.`,
		omittedNote ? omittedNote.trimEnd() : '',
		'',
		entries.join('\n\n'),
		'</conversation_transcript>',
	]
		.filter((line, idx) => {
			// Remove the empty line placeholder when there's no omitted note
			if (idx === 4 && !omittedNote) return false;
			return true;
		})
		.join('\n');

	if (tools.length === 0) return transcript;
	return transcript + '\n\n' + buildToolInstructions(toToolSpecs(tools));
}

// ---------------------------------------------------------------------------
// toToolSpecs
// ---------------------------------------------------------------------------

export function toToolSpecs(tools: AnthropicToolDef[]): ToolSpec[] {
	return tools.map(t => ({
		name: t.name,
		description: t.description ?? '',
		args: JSON.stringify(t.input_schema ?? {}),
		inputSchema: t.input_schema,
	}));
}

// ---------------------------------------------------------------------------
// mapCompletion
// ---------------------------------------------------------------------------

export function mapCompletion(content: string, toolNames: ReadonlySet<string>): Completion {
	// When no tools advertised, treat everything as prose
	if (toolNames.size === 0) {
		return { text: content, toolUses: [], stopReason: 'end_turn' };
	}

	const requests = parseToolRequests(content);
	const toolUses: AnthropicToolUseBlock[] = [];
	const droppedNames: string[] = [];

	for (const req of requests) {
		if (toolNames.has(req.tool)) {
			toolUses.push({
				type: 'tool_use',
				id: newToolUseId(),
				name: req.tool,
				input: req.args,
			});
		} else {
			droppedNames.push(req.tool);
		}
	}

	let text = stripToolRequestBlocks(content);
	for (const name of droppedNames) {
		text += `\n(Ignored tool request for unknown tool: ${name})`;
	}

	const stopReason = toolUses.length > 0 ? 'tool_use' : 'end_turn';
	return { text, toolUses, stopReason };
}

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// id helpers
// ---------------------------------------------------------------------------

export function newMessageId(): string {
	return 'msg_' + crypto.randomBytes(12).toString('hex');
}

export function newToolUseId(): string {
	return 'toolu_' + crypto.randomBytes(12).toString('hex');
}

// ---------------------------------------------------------------------------
// Conversation-reuse support
// ---------------------------------------------------------------------------

/**
 * Serializes one message to its canonical hash/em transcript line:
 * `${ROLE}: ${parts.join('\n')}` with ROLE 'USER' | 'ASSISTANT'.
 * Uses the UNtruncated parts (truncation is a buildBackendMessage display
 * concern; keys must be stable regardless of entry size).
 */
export function entryLine(role: 'user' | 'assistant', parts: readonly string[]): string {
	const ROLE = role === 'user' ? 'USER' : 'ASSISTANT';
	return `${ROLE}: ${parts.join('\n')}`;
}

/**
 * The assistant entry line the NEXT request will contain after we return
 * `completion`. MUST byte-match what parseAnthropicRequest would produce from
 * the echoed response blocks.
 *
 * parts = [completion.text (only when non-empty),
 *          ...completion.toolUses.map(t =>
 *            `Requested editor tool: ${t.name} ${JSON.stringify(t.input)}`)]
 */
export function predictedAssistantLine(completion: Completion): string {
	const parts: string[] = [];
	if (completion.text) parts.push(completion.text);
	for (const tu of completion.toolUses) {
		parts.push(`Requested editor tool: ${tu.name} ${JSON.stringify(tu.input)}`);
	}
	return entryLine('assistant', parts);
}

/**
 * The serialized reuse-turn message: the trailing new entries' parts joined
 * with '\n\n', then '\n\n' + buildToolInstructions(specs) when specs is
 * non-empty (reuse turns re-ship ONLY the tool instructions — the warm
 * conversation already holds the transcript).
 */
export function buildReuseTurnMessage(
	tail: readonly AnthropicRequest['messages'][number][],
	specs: ToolSpec[],
): string {
	const parts = tail.map(m => m.parts.join('\n')).filter(Boolean);
	let msg = parts.join('\n\n');
	if (specs.length > 0) {
		msg += '\n\n' + buildToolInstructions(specs);
	}
	return msg;
}
