import vscode from 'vscode';
import {
	buildToolInstructions,
	parseToolRequests,
	type ToolRequest,
	type ToolResult,
	type ToolSpec,
} from '../tools/toolProtocol';

/**
 * Translates between VS Code's language-model tool-calling contract and
 * RoboRewsty's text tool protocol. The backend model knows nothing about
 * LanguageModelChatTool: tools are advertised as instruction text, and the
 * model's fenced vscode-tool requests are converted into tool-call parts that
 * VS Code executes and answers with tool-result parts.
 */

/** Converts VS Code's chat tools into the text protocol's tool specs. */
export function chatToolSpecs(tools: readonly vscode.LanguageModelChatTool[]): ToolSpec[] {
	return tools.map(tool => ({
		name: tool.name,
		description: tool.description,
		args: tool.inputSchema ? JSON.stringify(tool.inputSchema) : '{}',
		inputSchema: tool.inputSchema,
	}));
}

/** Instruction text advertising the given chat tools via the text protocol. */
export function buildInstructionsForChatTools(tools: readonly vscode.LanguageModelChatTool[]): string {
	return buildToolInstructions(chatToolSpecs(tools));
}

export interface TranslatedToolCalls {
	/** Tool-call parts for permitted requests, in request order. */
	calls: vscode.LanguageModelToolCallPart[];
	/** Names the model requested that were not in the permitted set. */
	rejectedNames: string[];
}

let callCounter = 0;

/**
 * Converts the vscode-tool requests in a completed answer into tool-call parts.
 * A request whose tool is not in the permitted set is never emitted as a call
 * (VS Code could not invoke it) — it is reported back so the caller can answer
 * with plain text instead of a stalled call.
 */
export function translateToolRequests(content: string, permittedNames: ReadonlySet<string>): TranslatedToolCalls {
	const calls: vscode.LanguageModelToolCallPart[] = [];
	const rejectedNames: string[] = [];
	for (const request of parseToolRequests(content)) {
		if (!permittedNames.has(request.tool)) {
			rejectedNames.push(request.tool);
			continue;
		}
		calls.push(toToolCallPart(request));
	}
	return { calls, rejectedNames };
}

function toToolCallPart(request: ToolRequest): vscode.LanguageModelToolCallPart {
	const callId = `rewst-${request.tool}-${++callCounter}-${Date.now().toString(36)}`;
	return new vscode.LanguageModelToolCallPart(callId, request.tool, request.args);
}

export interface PartitionedToolRequests {
	/** Built-in/external tool calls VS Code's chat orchestrator runs and replays. */
	vscodeCalls: vscode.LanguageModelToolCallPart[];
	/** Rewst (buddy) tool requests the extension runs in-process via the MCP surface. */
	buddyRequests: ToolRequest[];
	/** Names the model requested that belong to neither set. */
	rejectedNames: string[];
}

/**
 * Splits a reply's tool requests by who runs them. Buddy (MCP) tools are handled
 * in-process so they never depend on VS Code's capped options.tools list, so a
 * name in the buddy set is routed there even when VS Code also passed it as a
 * built-in tool this turn; everything else is a VS Code call or a rejection.
 */
export function partitionToolRequests(
	content: string,
	vscodeNames: ReadonlySet<string>,
	buddyNames: ReadonlySet<string>,
): PartitionedToolRequests {
	const vscodeCalls: vscode.LanguageModelToolCallPart[] = [];
	const buddyRequests: ToolRequest[] = [];
	const rejectedNames: string[] = [];
	for (const request of parseToolRequests(content)) {
		if (buddyNames.has(request.tool)) buddyRequests.push(request);
		else if (vscodeNames.has(request.tool)) vscodeCalls.push(toToolCallPart(request));
		else rejectedNames.push(request.tool);
	}
	return { vscodeCalls, buddyRequests, rejectedNames };
}

/**
 * Compact message feeding in-process (buddy/MCP) tool outputs back into the same
 * backend conversation that emitted the requests. Mirrors
 * {@link formatToolResultsMessage}; a failed result is labeled so the model
 * reads it as an error to recover from, not as tool data.
 */
export function formatInProcessToolResults(results: readonly ToolResult[]): string {
	const sections: string[] = ['Tool results:'];
	for (const result of results) {
		const argsLabel = result.argsLabel ? ` ${result.argsLabel}` : '';
		const status = result.ok ? '' : ' (error)';
		sections.push(`### ${result.tool}${argsLabel}${status}\n\`\`\`\n${result.output}\n\`\`\``);
	}
	sections.push('Reply with more vscode-tool blocks if you need anything else, or give your final answer.');
	return sections.join('\n\n');
}

interface ToolCallInfo {
	name: string;
	input: unknown;
}

/** callId → call info, collected from the assistant messages in a history. */
export function collectToolCalls(
	messages: readonly Pick<vscode.LanguageModelChatRequestMessage, 'role' | 'content'>[],
): Map<string, ToolCallInfo> {
	const calls = new Map<string, ToolCallInfo>();
	for (const message of messages) {
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) continue;
		for (const part of message.content) {
			const candidate = part as { callId?: unknown; name?: unknown; input?: unknown };
			if (typeof candidate?.callId === 'string' && typeof candidate.name === 'string') {
				calls.set(candidate.callId, { name: candidate.name, input: candidate.input });
			}
		}
	}
	return calls;
}

interface ToolResultPartLike {
	callId: string;
	content: readonly unknown[];
}

/**
 * The tool-result parts of the trailing message, when this request is VS Code
 * handing back the outputs of tool calls we emitted last turn. Undefined when
 * the trailing message is an ordinary user turn.
 */
export function extractTrailingToolResults(
	messages: readonly Pick<vscode.LanguageModelChatRequestMessage, 'role' | 'content'>[],
): ToolResultPartLike[] | undefined {
	const last = messages[messages.length - 1];
	if (!last || last.role !== vscode.LanguageModelChatMessageRole.User) return undefined;
	const results: ToolResultPartLike[] = [];
	for (const part of last.content) {
		const candidate = part as { callId?: unknown; name?: unknown; content?: unknown };
		if (
			typeof candidate?.callId === 'string' &&
			typeof candidate.name !== 'string' &&
			Array.isArray(candidate.content)
		) {
			results.push({ callId: candidate.callId, content: candidate.content });
		}
	}
	return results.length > 0 ? results : undefined;
}

function partText(part: unknown): string {
	if (typeof part === 'string') return part;
	const candidate = part as { value?: unknown };
	return typeof candidate?.value === 'string' ? candidate.value : '';
}

/**
 * Compact message feeding tool outputs back into the same backend conversation
 * that emitted the calls (the reuse path). The conversation already holds the
 * question and prior context, so only the results — labeled by tool name and
 * args — are sent, not the whole transcript.
 */
export function formatToolResultsMessage(
	results: readonly ToolResultPartLike[],
	calls: ReadonlyMap<string, ToolCallInfo>,
): string {
	const sections: string[] = ['Tool results:'];
	for (const result of results) {
		const call = calls.get(result.callId);
		const name = call?.name ?? 'tool';
		const argsLabel = call?.input === undefined ? '' : ` ${JSON.stringify(call.input)}`;
		const output = result.content.map(partText).filter(Boolean).join('\n');
		sections.push(`### ${name}${argsLabel}\n\`\`\`\n${output}\n\`\`\``);
	}
	sections.push('Reply with more vscode-tool blocks if you need anything else, or give your final answer.');
	return sections.join('\n\n');
}

/** Note appended when the model asked for tools that cannot be invoked. */
export function rejectedToolsNote(names: readonly string[]): string {
	const unique = [...new Set(names)];
	return `\n\n*Cage-Free Rewsty requested ${unique.length === 1 ? 'a tool' : 'tools'} not available in this chat (${unique
		.map(name => `\`${name}\``)
		.join(
			', ',
		)}). Pick the tool in the chat tool picker if it is a VS Code built-in, or use the MCP server for Rewst-specific tools, then ask again.*\n`;
}

/** One ToolRequest shape for dedupe/labeling reuse elsewhere. */
export type { ToolRequest };
