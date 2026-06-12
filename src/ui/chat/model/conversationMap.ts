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
 * request will compute.
 *
 * Only USER messages form the key — the "user spine" of the chat. Assistant
 * text and tool-call parts are re-serialized by VS Code when it replays history,
 * and that serialization drifts from the bytes we streamed (whitespace/markdown
 * normalization, cumulative-resend dedup, large tables). Including assistant
 * content in the key made a single drifted character spawn a fresh backend
 * conversation — the chat would forget everything before the drift. User text
 * and tool-result callIds, by contrast, are preserved verbatim across replays,
 * so a user-only key is stable for the life of the chat. Tool rounds get an
 * even stronger, callId-based binding (see storeByCallIds).
 *
 * Inherent limit of a session-id-less stateless API: two same-org chats whose
 * USER messages are byte-identical share one backend conversation until their
 * user turns diverge — and once one of them advances the shared conversation's
 * tip, the other's next turn reads as behind-tip and forks (see below) rather
 * than silently re-attaching. Distinct orgs or distinct user content always
 * isolate.
 *
 * Rewind handling: the backend conversation is append-only (the API has no
 * message deletion), so when VS Code rewinds the transcript — Restore
 * Checkpoint, or editing an earlier message — re-attaching to the same
 * conversation would give the model memory of the rolled-back turns. Each
 * entry therefore records the user-turn DEPTH of its spine, and a lookup that
 * lands behind the conversation's deepest known turn reads as a miss: the
 * caller forks a fresh backend conversation seeded from the editor transcript.
 */

export const MAX_ENTRIES = 200;

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

// LanguageModelChatMessageRole.User — the only role that participates in the key.
const USER_ROLE = 1;

/**
 * Canonical serialization of a message sequence's USER spine. Assistant messages
 * are dropped because VS Code's replay serialization of them drifts from what we
 * streamed; user messages (typed text and verbatim tool-result callIds) survive
 * replay byte-for-byte, so they form a stable continuity key.
 */
export function serializeHistory(messages: readonly RequestMessage[]): string {
	return messages
		.filter(message => message.role === USER_ROLE)
		.map(message => serializeMessage(message.role, message.content))
		.join('');
}

/** Key for a request: org + the user spine of everything except the trailing turn. */
export function prefixKey(orgId: string, messages: readonly RequestMessage[]): string {
	return getHash(`${orgId}${serializeHistory(messages.slice(0, -1))}`);
}

/**
 * Key the NEXT request will compute after this turn: org + the user spine of the
 * full current history. The assistant message this turn appends carries no user
 * content, and the next request's own trailing (user) turn is excluded from its
 * prefix — so the next prefix's user spine equals this history's user spine.
 */
export function nextTurnKey(orgId: string, messages: readonly RequestMessage[]): string {
	return getHash(`${orgId}${serializeHistory(messages)}`);
}

/**
 * User-turn count of the given message list — the depth of its spine. Pass the
 * same slice the key was built from (full history for nextTurnKey, all but the
 * trailing turn for prefixKey).
 */
export function spineDepth(messages: readonly RequestMessage[]): number {
	return messages.filter(message => message.role === USER_ROLE).length;
}

interface Entry {
	conversationId: string;
	/** User-turn count of the spine this key was built from. */
	depth: number;
}

export class ConversationMap {
	private entries = new Map<string, Entry>();
	/** Deepest stored spine per conversation — the conversation's tip. */
	private tipDepth = new Map<string, number>();
	private byCallId = new Map<string, string>();
	private pendingResume = new Map<string, string>();

	/**
	 * The backend conversation a request prefix belongs to, if known — unless
	 * the prefix sits BEHIND the conversation's tip (the transcript was
	 * rewound), which reads as a miss so the caller forks instead.
	 */
	lookup(key: string): string | undefined {
		const entry = this.entries.get(key);
		if (entry === undefined) return undefined;
		const tip = this.tipDepth.get(entry.conversationId) ?? entry.depth;
		// A rewound prefix can never re-attach — let it age out of the LRU
		// rather than refreshing it at the expense of live entries.
		if (entry.depth < tip) return undefined;
		// Refresh LRU position.
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.conversationId;
	}

	store(key: string, conversationId: string, depth: number): void {
		this.entries.delete(key);
		this.entries.set(key, { conversationId, depth });
		while (this.entries.size > MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		// The tip record must stay at least as recent as every entry that
		// references its conversation (a replayed turn re-stores a behind-tip
		// key): if the tip evicted first, the surviving entry's fallback would
		// re-attach to a conversation that still holds rolled-back turns.
		const tip = this.tipDepth.get(conversationId);
		this.tipDepth.delete(conversationId);
		this.tipDepth.set(conversationId, tip === undefined || depth > tip ? depth : tip);
		while (this.tipDepth.size > MAX_ENTRIES) {
			const oldest = this.tipDepth.keys().next().value;
			if (oldest === undefined) break;
			this.tipDepth.delete(oldest);
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
		this.tipDepth.clear();
		this.byCallId.clear();
		this.pendingResume.clear();
	}
}

/** Shared instance used by the provider and the resume command. */
export const conversationMap = new ConversationMap();
