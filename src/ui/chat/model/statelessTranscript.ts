import { getHash } from '@utils';
import vscode from 'vscode';

const MAX_ENTRY_CHARS = 8_000;
const MAX_TOTAL_CHARS = 64_000;

type RequestMessage = Pick<vscode.LanguageModelChatRequestMessage, 'role' | 'content'>;

interface ToolCallInfo {
	name: string;
	input: unknown;
}

interface PartLike {
	value?: unknown;
	callId?: unknown;
	name?: unknown;
	input?: unknown;
	content?: unknown;
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function textOf(part: unknown): string {
	if (typeof part === 'string') return part;
	const candidate = part as PartLike;
	return typeof candidate?.value === 'string' ? candidate.value : '';
}

function stripActivity(text: string): string {
	return text.replace(/^> _.*_$/gm, '').trim();
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)} ...(truncated)` : text;
}

function roleLabel(role: vscode.LanguageModelChatMessageRole): string {
	if (role === vscode.LanguageModelChatMessageRole.User) return 'USER';
	if (role === vscode.LanguageModelChatMessageRole.Assistant) return 'ASSISTANT';
	return 'MESSAGE';
}

function collectCalls(messages: readonly RequestMessage[]): Map<string, ToolCallInfo> {
	const calls = new Map<string, ToolCallInfo>();
	for (const message of messages) {
		for (const part of message.content) {
			const candidate = part as PartLike;
			if (typeof candidate?.callId === 'string' && typeof candidate.name === 'string') {
				calls.set(candidate.callId, { name: candidate.name, input: candidate.input });
			}
		}
	}
	return calls;
}

function serializePart(part: unknown, calls: ReadonlyMap<string, ToolCallInfo>): string {
	const text = stripActivity(textOf(part));
	if (text) return text;

	const candidate = part as PartLike;
	if (typeof candidate?.callId !== 'string') return '';

	if (typeof candidate.name === 'string') {
		const args = candidate.input === undefined ? '' : ` ${safeJson(candidate.input)}`;
		return `Requested editor tool: ${candidate.name}${args}`;
	}

	if (Array.isArray(candidate.content)) {
		const call = calls.get(candidate.callId);
		const name = call?.name ?? 'tool';
		const args = call?.input === undefined ? '' : ` ${safeJson(call.input)}`;
		const output = candidate.content.map(textOf).filter(Boolean).join('\n');
		return `Editor tool result: ${name}${args}\n${output}`;
	}

	return '';
}

export function serializeVisibleChat(messages: readonly RequestMessage[]): string {
	const calls = collectCalls(messages);
	const entries: string[] = [];

	for (const message of messages) {
		const body = message.content
			.map(part => serializePart(part, calls))
			.filter(Boolean)
			.join('\n')
			.trim();
		if (!body) continue;
		entries.push(
			`${roleLabel(message.role as vscode.LanguageModelChatMessageRole)}: ${truncate(body, MAX_ENTRY_CHARS)}`,
		);
	}

	if (entries.length === 0) return '';

	let dropped = 0;
	let total = entries.reduce((sum, entry) => sum + entry.length, 0);
	while (total > MAX_TOTAL_CHARS && entries.length > 1) {
		const removed = entries.shift();
		if (removed === undefined) break;
		total -= removed.length;
		dropped++;
	}

	const omitted = dropped > 0 ? `\n(${dropped} earlier message(s) omitted)` : '';
	return `<visible_chat_transcript>
The user is talking from VS Code. Treat this visible transcript as the authoritative conversation context. Answer only the latest USER entry; use earlier entries only as context.${omitted}

${entries.join('\n\n')}
</visible_chat_transcript>`;
}

/** Key used only to identify the latest retained transient Rewst conversation for this visible chat branch. */
export function visibleChatKey(orgId: string, messages: readonly RequestMessage[]): string {
	const userSpine = messages
		.filter(message => message.role === vscode.LanguageModelChatMessageRole.User)
		.map(message =>
			message.content
				.map(part => {
					const candidate = part as PartLike;
					if (typeof part === 'string') return part;
					if (typeof candidate?.value === 'string') return candidate.value;
					if (typeof candidate?.callId === 'string') return `:${candidate.callId}:`;
					return '';
				})
				.join(''),
		)
		.join('\u0001');
	return getHash(`${orgId}\u0001${userSpine}`);
}

export function visibleChatPrefixKey(orgId: string, messages: readonly RequestMessage[]): string {
	return visibleChatKey(orgId, messages.slice(0, -1));
}
