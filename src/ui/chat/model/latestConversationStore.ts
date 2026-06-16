export interface RetainedConversation {
	key: string;
	conversationId: string;
}

export class LatestConversationStore {
	private byKey = new Map<string, string>();
	private byCallId = new Map<string, RetainedConversation>();

	lookup(key: string): RetainedConversation | undefined {
		const conversationId = this.byKey.get(key);
		return conversationId ? { key, conversationId } : undefined;
	}

	lookupByCallIds(callIds: readonly string[]): RetainedConversation | undefined {
		for (const callId of callIds) {
			const retained = this.byCallId.get(callId);
			if (retained) return retained;
		}
		return undefined;
	}

	bindCallIds(callIds: readonly string[], key: string, conversationId: string): void {
		for (const callId of callIds) {
			this.byCallId.set(callId, { key, conversationId });
		}
	}

	storeLatest(key: string, conversationId: string, previous?: RetainedConversation): void {
		if (previous && previous.key !== key) this.byKey.delete(previous.key);
		this.byKey.set(key, conversationId);
		for (const [callId, retained] of this.byCallId) {
			if (previous && retained.conversationId === previous.conversationId) this.byCallId.delete(callId);
		}
	}

	_resetForTesting(): void {
		this.byKey.clear();
		this.byCallId.clear();
	}
}

export const latestConversationStore = new LatestConversationStore();
