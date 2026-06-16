import { getHash } from '@utils';
import type vscode from 'vscode';

/**
 * Maps the stateless LanguageModelChatProvider request shape onto RoboRewsty's
 * stateful backend conversations so a chat can REUSE one warm conversation
 * instead of opening a fresh one (and re-shipping the whole transcript) every
 * turn.
 *
 * The provider API sends the full message history on every request and exposes
 * no chat-session id, so continuity is content-derived: each request's history
 * PREFIX (everything except the trailing turn) is hashed together with the org
 * id, and the map remembers which backend conversationId that prefix belongs
 * to. When a turn finishes, the entry is re-stored under the key the NEXT
 * request will compute.
 *
 * Only USER messages form the key — the "user spine" of the chat. Assistant
 * text re-serializes with drift across replays (whitespace/markdown
 * normalization, cumulative-resend dedup); user text and tool-result callIds
 * survive verbatim. Including assistant content would let one drifted character
 * spawn a fresh conversation and forget everything before the drift. Tool rounds
 * get an even stronger, callId-based binding (storeByCallIds).
 *
 * Inherent limit of a session-id-less API: two same-org chats whose USER
 * messages are byte-identical share one backend conversation until their user
 * turns diverge. The breadcrumb (see breadcrumb.ts) disambiguates that case by
 * carrying the exact per-chat conversationId in the transcript itself.
 *
 * Rewind handling: the backend conversation is append-only (no message
 * deletion), so when VS Code rewinds the transcript — Restore Checkpoint, or
 * editing an earlier message — re-attaching would give the model memory of the
 * rolled-back turns. Each entry records the user-turn DEPTH of its spine, and a
 * lookup that lands behind the conversation's deepest known turn reads as
 * unfollowable: the caller forks a fresh conversation (and deletes the stale one).
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
		.join('');
}

/** Key for a request: org + the user spine of everything except the trailing turn. */
export function prefixKey(orgId: string, messages: readonly RequestMessage[]): string {
	return getHash(`${orgId}${serializeHistory(messages.slice(0, -1))}`);
}

/**
 * Key the NEXT request will compute after this turn: org + the user spine of the
 * full current history. The assistant message this turn appends carries no user
 * content, and the next request's own trailing (user) turn is excluded from its
 * prefix — so the next prefix's user spine equals this history's user spine.
 */
export function nextTurnKey(orgId: string, messages: readonly RequestMessage[]): string {
	return getHash(`${orgId}${serializeHistory(messages)}`);
}

/** User-turn count of the given message list — the depth of its spine. */
export function spineDepth(messages: readonly RequestMessage[]): number {
	return messages.filter(message => message.role === USER_ROLE).length;
}

interface Entry {
	conversationId: string;
	/** User-turn count of the spine this key was built from. */
	depth: number;
}

/** Result of a spine-hash lookup: the matched conversation and whether it is still followable. */
export interface ConversationMatch {
	conversationId: string;
	/** False when the prefix sits behind the conversation's tip — the transcript was rewound. */
	followable: boolean;
}

export class ConversationMap {
	private entries = new Map<string, Entry>();
	/** Deepest stored spine per conversation — the conversation's tip. */
	private tipDepth = new Map<string, number>();
	private byCallId = new Map<string, string>();

	/**
	 * The backend conversation a request prefix belongs to, if known, plus
	 * whether it is followable. A prefix BEHIND the conversation's tip (the
	 * transcript was rewound) is reported as unfollowable so the caller forks.
	 */
	lookup(key: string): ConversationMatch | undefined {
		const entry = this.entries.get(key);
		if (entry === undefined) return undefined;
		const tip = this.tipDepth.get(entry.conversationId) ?? entry.depth;
		if (entry.depth < tip) return { conversationId: entry.conversationId, followable: false };
		// Refresh LRU position for live branches.
		this.entries.delete(key);
		this.entries.set(key, entry);
		return { conversationId: entry.conversationId, followable: true };
	}

	/**
	 * Whether a breadcrumb-named conversation at the given depth is still
	 * followable: known to us and not behind its tip (not rewound). Unknown
	 * conversations (evicted / window reloaded) cannot be tip-checked, so they
	 * are rejected — the caller falls back to the spine hash, then stateless.
	 */
	breadcrumbFollowable(conversationId: string, depth: number): boolean {
		const tip = this.tipDepth.get(conversationId);
		if (tip === undefined) return false;
		return depth >= tip;
	}

	store(key: string, conversationId: string, depth: number): void {
		this.entries.delete(key);
		this.entries.set(key, { conversationId, depth });
		while (this.entries.size > MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		// The tip must stay at least as recent as every entry referencing its
		// conversation: if the tip evicted first, a surviving behind-tip entry
		// would wrongly read as followable.
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
	 * message and hands back the result, so recovering by callId is immune to
	 * the serialization drift the prefix hash is vulnerable to — the primary
	 * continuity path for tool rounds.
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
	 * Drop every trace of a conversation — used when we fork away from it
	 * (rewind / an unfollowable reuse) so later lookups never re-attach to the
	 * backend conversation we are deleting.
	 */
	forget(conversationId: string): void {
		for (const [key, entry] of this.entries) {
			if (entry.conversationId === conversationId) this.entries.delete(key);
		}
		this.tipDepth.delete(conversationId);
		for (const [callId, id] of this.byCallId) {
			if (id === conversationId) this.byCallId.delete(callId);
		}
	}

	/** Clears all state between tests. */
	_resetForTesting(): void {
		this.entries.clear();
		this.tipDepth.clear();
		this.byCallId.clear();
	}
}

/** Shared instance used by the provider. */
export const conversationMap = new ConversationMap();
