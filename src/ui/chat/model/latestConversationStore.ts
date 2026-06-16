export interface RetainedConversation {
	key: string;
	conversationId: string;
}

export interface PendingConversation extends RetainedConversation {
	previousLatest?: RetainedConversation;
}

// Caps for a long-lived editor window. Each distinct visible-chat branch keeps
// one retained conversation, and each tool/approval round binds its call ids;
// abandoned branches and rounds the user never finishes (e.g. a cancelled
// in-chat approval) would otherwise accumulate forever. Eviction drops the
// least-recently-used entry — the backend conversation it named is then left as
// an orphan, the same outcome as any never-superseded final turn.
const MAX_RETAINED_KEYS = 128;
const MAX_PENDING_CALL_IDS = 256;

function evictOldest<V>(map: Map<string, V>, max: number): void {
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

export class LatestConversationStore {
	private byKey = new Map<string, string>();
	private byCallId = new Map<string, PendingConversation>();

	lookup(key: string): RetainedConversation | undefined {
		const conversationId = this.byKey.get(key);
		if (conversationId === undefined) return undefined;
		// Touch so active branches stay at the MRU end and survive eviction.
		this.byKey.delete(key);
		this.byKey.set(key, conversationId);
		return { key, conversationId };
	}

	lookupByCallIds(callIds: readonly string[]): PendingConversation | undefined {
		for (const callId of callIds) {
			const retained = this.byCallId.get(callId);
			if (retained) return retained;
		}
		return undefined;
	}

	bindCallIds(
		callIds: readonly string[],
		key: string,
		conversationId: string,
		previousLatest?: RetainedConversation,
	): void {
		for (const callId of callIds) {
			this.byCallId.set(callId, { key, conversationId, ...(previousLatest ? { previousLatest } : {}) });
		}
		evictOldest(this.byCallId, MAX_PENDING_CALL_IDS);
	}

	forgetConversation(conversationId: string): void {
		for (const [callId, retained] of this.byCallId) {
			if (retained.conversationId === conversationId) this.byCallId.delete(callId);
		}
	}

	storeLatest(key: string, conversationId: string, previous?: RetainedConversation): void {
		if (previous && previous.key !== key) this.byKey.delete(previous.key);
		this.byKey.delete(key);
		this.byKey.set(key, conversationId);
		if (previous) this.forgetConversation(previous.conversationId);
		evictOldest(this.byKey, MAX_RETAINED_KEYS);
	}

	_resetForTesting(): void {
		this.byKey.clear();
		this.byCallId.clear();
	}
}

export const latestConversationStore = new LatestConversationStore();
