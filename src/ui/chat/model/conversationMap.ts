import { getHash } from '@utils';
import type vscode from 'vscode';

/**
 * Maps the stateless LanguageModelChatProvider request shape onto RoboRewsty's
 * stateful backend conversations.
 *
 * The provider API sends the full message history on every request and exposes
 * no chat-session id, so continuity is content-derived: each request's history
 * PREFIX (everything except the trailing turn) is hashed together with the org
 * id, and the map remembers which backend conversationId that prefix belongs
 * to. When a turn finishes, the entry is re-stored under the key the NEXT
 * request will compute — the current history plus the assistant parts just
 * emitted.
 *
 * Inherent limit of a session-id-less stateless API: two same-org chats with
 * byte-identical histories share one backend conversation until their
 * histories diverge. Distinct orgs or distinct content always isolate.
 */

const MAX_ENTRIES = 200;

/** The provider-message subset that matters for identity. */
type RequestMessage = Pick<vscode.LanguageModelChatRequestMessage, 'role' | 'content'>;

interface PartLike {
	value?: unknown; // LanguageModelTextPart
	callId?: unknown; // LanguageModelToolCallPart / LanguageModelToolResultPart
	name?: unknown; // LanguageModelToolCallPart
	input?: unknown; // LanguageModelToolCallPart
	content?: unknown; // LanguageModelToolResultPart
}

/**
 * Text content is appended raw (no per-part delimiters) so chunking is
 * irrelevant: the many text parts a streaming turn emits serialize identically
 * to the single consolidated text part the next request carries.
 */
function serializeMessage(role: number, content: readonly unknown[]): string {
	let out = `${role}|`;
	for (const part of content) {
		if (typeof part === 'string') {
			out += part;
			continue;
		}
		if (typeof part !== 'object' || part === null) continue;
		const candidate = part as PartLike;
		if (typeof candidate.value === 'string') {
			out += candidate.value;
		} else if (typeof candidate.callId === 'string') {
			// Tool call (has name) or tool result — the callId alone identifies
			// the exchange within a history.
			out +=
				typeof candidate.name === 'string'
					? ` c:${candidate.callId}:${candidate.name} `
					: ` r:${candidate.callId} `;
		}
	}
	return out;
}

/** Canonical serialization of a message sequence, for prefix keying. */
export function serializeHistory(messages: readonly RequestMessage[]): string {
	return messages.map(message => serializeMessage(message.role, message.content)).join('');
}

/** Key for a request: org + everything except the trailing turn. */
export function prefixKey(orgId: string, messages: readonly RequestMessage[]): string {
	return getHash(`${orgId}${serializeHistory(messages.slice(0, -1))}`);
}

/**
 * Key the NEXT request will compute after this turn: org + the full current
 * history + the assistant parts emitted this turn (the next request appends
 * them as an Assistant message before its own trailing turn).
 */
export function nextTurnKey(
	orgId: string,
	messages: readonly RequestMessage[],
	emittedParts: readonly unknown[],
): string {
	const assistant = serializeMessage(2, emittedParts); // LanguageModelChatMessageRole.Assistant
	const history = `${serializeHistory(messages)}${assistant}`;
	return getHash(`${orgId}${history}`);
}

export class ConversationMap {
	private entries = new Map<string, string>();
	private byCallId = new Map<string, string>();
	private pendingResume = new Map<string, string>();

	/** The backend conversation a request prefix belongs to, if known. */
	lookup(key: string): string | undefined {
		const conversationId = this.entries.get(key);
		if (conversationId !== undefined) {
			// Refresh LRU position.
			this.entries.delete(key);
			this.entries.set(key, conversationId);
		}
		return conversationId;
	}

	store(key: string, conversationId: string): void {
		this.entries.delete(key);
		this.entries.set(key, conversationId);
		while (this.entries.size > MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}

	/**
	 * Bind a backend conversation to the tool calls emitted this turn. VS Code
	 * preserves a tool call's callId verbatim when it replays the assistant
	 * message and hands back the result, so recovering the conversation by
	 * callId is immune to the message-serialization drift that the prefix hash
	 * is vulnerable to — this is the primary continuity path for tool rounds.
	 */
	storeByCallIds(callIds: readonly string[], conversationId: string): void {
		for (const callId of callIds) {
			this.byCallId.delete(callId);
			this.byCallId.set(callId, conversationId);
		}
		while (this.byCallId.size > MAX_ENTRIES) {
			const oldest = this.byCallId.keys().next().value;
			if (oldest === undefined) break;
			this.byCallId.delete(oldest);
		}
	}

	/** The backend conversation that emitted any of these tool calls, if known. */
	lookupByCallIds(callIds: readonly string[]): string | undefined {
		for (const callId of callIds) {
			const conversationId = this.byCallId.get(callId);
			if (conversationId !== undefined) return conversationId;
		}
		return undefined;
	}

	/**
	 * One-shot resume binding: the next FRESH turn (empty history prefix) for
	 * this org continues the given conversation instead of starting a new one.
	 */
	setPendingResume(orgId: string, conversationId: string): void {
		this.pendingResume.set(orgId, conversationId);
	}

	/** Consumes the binding; later fresh turns start new conversations again. */
	takePendingResume(orgId: string): string | undefined {
		const conversationId = this.pendingResume.get(orgId);
		this.pendingResume.delete(orgId);
		return conversationId;
	}

	/** Clears all state between tests. */
	_resetForTesting(): void {
		this.entries.clear();
		this.byCallId.clear();
		this.pendingResume.clear();
	}
}

/** Shared instance used by the provider and the resume command. */
export const conversationMap = new ConversationMap();
