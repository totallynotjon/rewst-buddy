/**
 * Multi-turn state recovery for the @rewst chat participant. The stable Chat
 * API has no session id, so the Rewst conversation id is round-tripped through
 * ChatResult.metadata and recovered from prior response turns.
 *
 * Structurally typed so unit tests don't need real vscode turn objects.
 */

export interface RewstTurnState {
	conversationId?: string;
	orgId?: string;
}

interface ResponseTurnLike {
	result?: { metadata?: { rewst?: RewstTurnState } };
}

export function findPriorTurnState(history: readonly unknown[]): RewstTurnState | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const rewst = (history[i] as ResponseTurnLike)?.result?.metadata?.rewst;
		if (rewst && (rewst.conversationId !== undefined || rewst.orgId !== undefined)) {
			return { conversationId: rewst.conversationId, orgId: rewst.orgId };
		}
	}
	return undefined;
}
