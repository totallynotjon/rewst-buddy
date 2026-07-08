/**
 * Transcript-prefix hashing + conversationId LRU cache for the Anthropic proxy.
 * Pure module — no vscode imports, no Date/timers.
 */
import crypto from 'crypto';

/**
 * sha256 hex over orgId, the normalized system string ('' when absent), and each
 * entry line, joined with '\n \n' (a separator that cannot appear inside a line
 * ambiguously).
 */
export function transcriptKey(orgId: string, system: string | undefined, entryLines: readonly string[]): string {
	const parts = [orgId, system ?? '', ...entryLines];
	return crypto.createHash('sha256').update(parts.join('\n \n')).digest('hex');
}

/**
 * LRU cache mapping transcript-prefix keys to backend conversationIds.
 * One live key per conversationId: when a conversation advances to a new key,
 * the old key is removed.
 */
export class ProxyConversationCache {
	/** key → conversationId */
	private readonly keyToId = new Map<string, string>();
	/** conversationId → key (reverse index for one-live-key invariant) */
	private readonly idToKey = new Map<string, string>();
	/** LRU order: front = most recently used, back = least recently used */
	private readonly lruOrder: string[] = [];

	constructor(private readonly maxEntries = 32) {}

	/** Returns the conversationId for the key, refreshing its LRU recency. */
	lookup(key: string): string | undefined {
		const id = this.keyToId.get(key);
		if (id === undefined) return undefined;
		// Move to front of LRU
		const idx = this.lruOrder.indexOf(key);
		if (idx >= 0) {
			this.lruOrder.splice(idx, 1);
			this.lruOrder.unshift(key);
		}
		return id;
	}

	/**
	 * Registers the conversation under `key`. A conversation has ONE live key:
	 * any previous key for the same conversationId is removed (the conversation
	 * advanced). Returns the conversationIds evicted by the LRU cap (for
	 * fire-and-forget backend deletion) — never includes `conversationId` itself.
	 */
	store(key: string, conversationId: string): string[] {
		// Remove any previous key for this conversationId (one-live-key invariant)
		const oldKey = this.idToKey.get(conversationId);
		if (oldKey !== undefined && oldKey !== key) {
			this.keyToId.delete(oldKey);
			const oldIdx = this.lruOrder.indexOf(oldKey);
			if (oldIdx >= 0) this.lruOrder.splice(oldIdx, 1);
		}

		// Upsert
		this.keyToId.set(key, conversationId);
		this.idToKey.set(conversationId, key);

		// Move/add to front of LRU
		const existingIdx = this.lruOrder.indexOf(key);
		if (existingIdx >= 0) this.lruOrder.splice(existingIdx, 1);
		this.lruOrder.unshift(key);

		// Evict LRU entries beyond the cap
		const evicted: string[] = [];
		while (this.lruOrder.length > this.maxEntries) {
			const evictedKey = this.lruOrder.pop()!;
			const evictedId = this.keyToId.get(evictedKey);
			this.keyToId.delete(evictedKey);
			if (evictedId !== undefined) {
				this.idToKey.delete(evictedId);
				// Never report the just-stored conversationId as evicted
				if (evictedId !== conversationId) {
					evicted.push(evictedId);
				}
			}
		}
		return evicted;
	}

	/** Drop whatever key maps to this conversationId. No-op if unknown. */
	forget(conversationId: string): void {
		const key = this.idToKey.get(conversationId);
		if (key === undefined) return;
		this.keyToId.delete(key);
		this.idToKey.delete(conversationId);
		const idx = this.lruOrder.indexOf(key);
		if (idx >= 0) this.lruOrder.splice(idx, 1);
	}
}
