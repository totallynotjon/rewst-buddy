import vscode from 'vscode';
import { buildToolInstructions, parseToolRequests, type ToolRequest, type ToolSpec } from '../tools/toolProtocol';
import { ALL_TOOL_SPECS, isToolPermitted, type AiToolSettings } from './lmTools';

/**
 * Translates between VS Code's language-model tool-calling contract and
 * RoboRewsty's text tool protocol. The backend model knows nothing about
 * LanguageModelChatTool: tools are advertised as instruction text, and the
 * model's fenced rewst-tool requests are converted into tool-call parts that
 * VS Code executes and answers with tool-result parts.
 */

const SPEC_BY_NAME = new Map(ALL_TOOL_SPECS.map(spec => [spec.name, spec]));

/**
 * The tools the model may be told about: whatever VS Code passed, minus any
 * rewst tool whose governing setting is off. A disabled tool is withheld even
 * when present in options.tools, preserving the settings semantics.
 */
export function filterToolsBySettings(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
	settings: AiToolSettings,
): vscode.LanguageModelChatTool[] {
	return (tools ?? []).filter(tool => isToolPermitted(tool.name, settings));
}

/** Instruction text advertising the given chat tools via the text protocol. */
export function buildInstructionsForChatTools(tools: readonly vscode.LanguageModelChatTool[]): string {
	const specs: ToolSpec[] = tools.map(tool => {
		const known = SPEC_BY_NAME.get(tool.name);
		if (known) return known;
		return {
			name: tool.name,
			description: tool.description,
			args: tool.inputSchema ? JSON.stringify(tool.inputSchema) : '{}',
		};
	});
	return buildToolInstructions(specs);
}

export interface TranslatedToolCalls {
	/** Tool-call parts for permitted requests, in request order. */
	calls: vscode.LanguageModelToolCallPart[];
	/** Names the model requested that were not in the permitted set. */
	rejectedNames: string[];
}

let callCounter = 0;

/**
 * Converts the rewst-tool requests in a completed answer into tool-call parts.
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
		const callId = `rewst-${request.tool}-${++callCounter}-${Date.now().toString(36)}`;
		calls.push(new vscode.LanguageModelToolCallPart(callId, request.tool, request.args));
	}
	return { calls, rejectedNames };
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
 * Builds the follow-up text-protocol message carrying tool outputs back to
 * RoboRewsty, labeled with the original tool names/args from the history.
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
	sections.push('Reply with more rewst-tool blocks if you need anything else, or give your final answer.');
	return sections.join('\n\n');
}

/** Note appended when the model asked for tools that cannot be invoked. */
export function rejectedToolsNote(names: readonly string[]): string {
	const unique = [...new Set(names)];
	return `\n\n*RoboRewsty requested ${unique.length === 1 ? 'a tool' : 'tools'} not available in this chat (${unique
		.map(name => `\`${name}\``)
		.join(
			', ',
		)}). Enable the corresponding rewst-buddy.ai setting or pick the tool in the chat tool picker, then ask again.*\n`;
}

/** One ToolRequest shape for dedupe/labeling reuse elsewhere. */
export type { ToolRequest };
