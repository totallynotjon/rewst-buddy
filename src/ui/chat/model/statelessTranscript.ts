import vscode from 'vscode';

const MAX_CHUNK_CHARS = 50_000;
const MAX_ENTRY_CHARS = 48_000;
// Keep enough history for long chats while leaving headroom for backend metadata.
const MAX_TOTAL_CHARS = 400_000;
const TRUNCATION_MARKER = '...(truncated)';
const TERMINAL_TOOL_NAME_PATTERN = /terminal/i;
const MAX_TERMINAL_OUTPUT_CHARS = 2_000;
const TERMINAL_OUTPUT_FRAME =
	'(raw terminal output — likely unrelated to the current request unless the user explicitly asked about the terminal)';

export type SeedRole = 'USER' | 'ASSISTANT';
export interface SeedChunk {
	role: SeedRole;
	content: string;
}

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
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

function collectCalls(messages: readonly RequestMessage[]): Map<string, ToolCallInfo> {
	const calls = new Map<string, ToolCallInfo>();
	for (const message of messages)
		for (const part of message.content) {
			const candidate = part as PartLike;
			if (typeof candidate?.callId === 'string' && typeof candidate.name === 'string') {
				calls.set(candidate.callId, { name: candidate.name, input: candidate.input });
			}
		}
	return calls;
}

function serializeToolPart(part: unknown, calls: ReadonlyMap<string, ToolCallInfo>): string {
	const candidate = part as PartLike;
	if (typeof candidate?.callId !== 'string') return '';
	if (typeof candidate.name === 'string') {
		const args = candidate.input === undefined ? '' : ` ${safeJson(candidate.input)}`;
		return `Requested editor tool: ${candidate.name}${args}`;
	}
	if (!Array.isArray(candidate.content)) return '';
	const call = calls.get(candidate.callId);
	const name = call?.name ?? 'tool';
	const args = call?.input === undefined ? '' : ` ${safeJson(call.input)}`;
	const rawOutput = candidate.content.map(textOf).filter(Boolean).join('\n');
	if (TERMINAL_TOOL_NAME_PATTERN.test(name)) {
		return `Editor tool result: ${name}${args}\n${TERMINAL_OUTPUT_FRAME}\n${truncate(rawOutput, MAX_TERMINAL_OUTPUT_CHARS)}`;
	}
	return `Editor tool result: ${name}${args}\n${rawOutput}`;
}

function appendChunk(chunks: SeedChunk[], entry: SeedChunk): void {
	const previous = chunks[chunks.length - 1];
	if (previous?.role === entry.role && previous.content.length + 1 + entry.content.length <= MAX_CHUNK_CHARS) {
		previous.content += `\n${entry.content}`;
	} else {
		chunks.push({ ...entry });
	}
}

function mergeSeedEntries(entries: readonly SeedChunk[]): SeedChunk[] {
	const chunks: SeedChunk[] = [];
	for (const entry of entries) appendChunk(chunks, entry);
	return chunks;
}

function totalSeedChars(chunks: readonly SeedChunk[]): number {
	return chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
}

function finalizeSeedEntries(entries: readonly SeedChunk[]): SeedChunk[] {
	const normalized = entries
		.filter(entry => entry && (entry.role === 'USER' || entry.role === 'ASSISTANT'))
		.map(entry => ({ role: entry.role, content: truncate(entry.content, MAX_CHUNK_CHARS) }))
		.filter(entry => entry.content.length > 0);
	const kept = normalized.slice();
	let dropped = 0;
	for (;;) {
		const prefix =
			dropped > 0 ? [{ role: 'USER' as const, content: `(${dropped} earlier message(s) omitted)` }] : [];
		const chunks = mergeSeedEntries([...prefix, ...kept]);
		if (totalSeedChars(chunks) <= MAX_TOTAL_CHARS || kept.length <= 1) return chunks;
		kept.shift();
		dropped++;
	}
}

/** Append internal role-aware interaction records while preserving the transcript budget. */
export function appendSeedChunks(base: readonly SeedChunk[], additions: readonly SeedChunk[]): SeedChunk[] {
	return finalizeSeedEntries([...base, ...additions]);
}

/** Serialize visible VS Code history into mutation-safe, role-aware seed chunks. */
export function serializeVisibleChat(messages: readonly RequestMessage[]): SeedChunk[] {
	const calls = collectCalls(messages);
	const entries: SeedChunk[] = [];
	for (const message of messages) {
		// SYSTEM and other provider-only roles must never be written as conversation
		// messages: the backend accepts only USER and ASSISTANT seed records.
		if (
			message.role !== vscode.LanguageModelChatMessageRole.User &&
			message.role !== vscode.LanguageModelChatMessageRole.Assistant
		)
			continue;
		const textRole: SeedRole =
			message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'ASSISTANT' : 'USER';
		for (const part of message.content) {
			const text = stripActivity(textOf(part));
			if (text) entries.push({ role: textRole, content: truncate(text, MAX_ENTRY_CHARS) });
			const tool = serializeToolPart(part, calls);
			if (tool) entries.push({ role: 'USER', content: truncate(tool, MAX_ENTRY_CHARS) });
		}
	}

	return finalizeSeedEntries(entries);
}
