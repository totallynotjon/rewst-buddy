import { perSectionBudget, TOOL_RESULTS_BUDGET_CHARS, truncateToBudget } from '@utils';
import vscode from 'vscode';
import { parseToolRequests, type ToolRequest, type ToolResult, type ToolSpec } from '../tools/toolProtocol';

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

let callCounter = 0;

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
export function formatInProcessToolResults(results: readonly ToolResult[], budget = TOOL_RESULTS_BUDGET_CHARS): string {
	const headers = results.map(result => {
		const argsLabel = result.argsLabel ? ` ${truncateToBudget(result.argsLabel, MAX_ARGS_LABEL_CHARS)}` : '';
		const status = result.ok ? '' : ' (error)';
		return `### ${result.tool}${argsLabel}${status}\n\`\`\`\n`;
	});
	// Labels, fences and the trailing instruction have to be sent whole, so only
	// what is left after them is available for result content.
	const perResult = perSectionBudget(contentBudget(budget, headers), results.length);
	const sections: string[] = [RESULTS_HEADER];
	results.forEach((result, index) => {
		sections.push(`${headers[index]}${truncateToBudget(result.output, perResult)}\n\`\`\``);
	});
	sections.push(RESULTS_FOOTER);
	return sections.join('\n\n');
}

/** Cap on the echoed args label in a result header. */
const MAX_ARGS_LABEL_CHARS = 300;

const RESULTS_HEADER = 'Tool results:';
const RESULTS_FOOTER = 'Reply with more vscode-tool blocks if you need anything else, or give your final answer.';

/**
 * Characters left for result content once every fixed part of the message — the
 * header, footer, per-result labels/fences and the separators between them — is
 * accounted for. Never negative; a pathological label set simply leaves nothing
 * for content rather than pushing the message over budget.
 */
function contentBudget(budget: number, headers: readonly string[]): number {
	const framing =
		RESULTS_HEADER.length +
		RESULTS_FOOTER.length +
		headers.reduce((sum, header) => sum + header.length + '\n```'.length, 0) +
		(headers.length + 1) * '\n\n'.length;
	return Math.max(0, budget - framing);
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
 * Compact message feeding tool outputs back into the next disposable backend
 * conversation. The visible transcript is seeded separately; this message is
 * only the results, labeled by tool name and args.
 */
export function formatToolResultsMessage(
	results: readonly ToolResultPartLike[],
	calls: ReadonlyMap<string, ToolCallInfo>,
	budget = TOOL_RESULTS_BUDGET_CHARS,
): string {
	// An args label is echoed from the model's own call and can itself be huge, so
	// it is capped before being charged against the framing.
	const headers = results.map(result => {
		const call = calls.get(result.callId);
		const name = call?.name ?? 'tool';
		const argsLabel =
			call?.input === undefined ? '' : ` ${truncateToBudget(JSON.stringify(call.input), MAX_ARGS_LABEL_CHARS)}`;
		return `### ${name}${argsLabel}\n\`\`\`\n`;
	});
	const perResult = perSectionBudget(contentBudget(budget, headers), results.length);
	const sections: string[] = [RESULTS_HEADER];
	results.forEach((result, index) => {
		const output = result.content.map(partText).filter(Boolean).join('\n');
		sections.push(`${headers[index]}${truncateToBudget(output, perResult)}\n\`\`\``);
	});
	sections.push(RESULTS_FOOTER);
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
