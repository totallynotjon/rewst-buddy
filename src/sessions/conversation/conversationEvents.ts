/**
 * Pure mapping from raw `conversationMessage` subscription payloads to typed
 * events. No vscode/ws imports — fully unit-testable.
 *
 * Payload semantics documented in docs/dev/rewst-ai-api.md (verified live).
 */

export interface ConversationSource {
	label: string;
	source: string;
	section?: string;
}

/** A server-side tool RoboRewsty wants to run, awaiting the user's approval. */
export interface ApprovalTool {
	name: string;
	args?: unknown;
	id?: string;
}

export type ConversationEvent =
	| { kind: 'registered'; requestId: string }
	| { kind: 'conversation'; conversationId: string }
	| { kind: 'status'; label: string }
	| { kind: 'chunk'; text: string }
	| {
			kind: 'complete';
			content: string;
			sources: ConversationSource[];
			conversationId?: string;
			messageId?: string;
	  }
	| {
			/**
			 * The turn paused because a Rewst-side agent tool needs approval. Carry
			 * the requestId so the caller can resume, and the raw metadata so the UI
			 * can still surface the requirement when the tool shape is unrecognized.
			 */
			kind: 'approval';
			tools: ApprovalTool[];
			requestId?: string;
			raw: Record<string, unknown>;
	  }
	| { kind: 'error'; message: string };

export interface RawConversationPayload {
	status?: string | null;
	conversation_id?: string | null;
	message?: { id?: string | null; content?: string | null; role?: string | null } | null;
	metadata?: Record<string, unknown> | null;
	error?: unknown;
}

const STATUS_LABELS: Record<string, string> = {
	thinking: 'Thinking…',
	streaming_thinking: 'Thinking…',
	summarizing: 'Summarizing conversation…',
	searching: 'Searching documentation…',
};

// Statuses with no UI mapping (context_usage, summarization_complete,
// search_complete, TOOL_CALL_COMPLETE, TOOL_SPECIFIC_EVENT, resume_*) fall
// through the switch default and are dropped.
const TERMINAL_ERROR_MESSAGES: Record<string, string> = {
	interrupted: 'The request was interrupted.',
	conversation_killed: 'The conversation was stopped by another client.',
};

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseSources(metadata: Record<string, unknown> | null | undefined): ConversationSource[] {
	const raw = metadata?.sources;
	if (!Array.isArray(raw)) return [];
	return raw.flatMap(entry => {
		if (typeof entry !== 'object' || entry === null) return [];
		const item = entry as Record<string, unknown>;
		const source = asString(item.source);
		if (!source) return [];
		return [
			{
				label: asString(item.label) ?? source,
				source,
				section: asString(item.section),
			},
		];
	});
}

/**
 * Parses the tool(s) awaiting approval from an approval_required payload. The
 * live field names are not verified (see docs/dev/rewst-ai-api.md), so this
 * mirrors the TOOL_CALL_IN_PROGRESS shape (metadata.toolCalls: [{ name, args,
 * id }]) and tolerates absence — the raw metadata still rides along on the event.
 */
function parseApprovalTools(metadata: Record<string, unknown> | undefined): ApprovalTool[] {
	const raw = metadata?.toolCalls;
	if (!Array.isArray(raw)) return [];
	return raw.flatMap(entry => {
		if (typeof entry !== 'object' || entry === null) return [];
		const item = entry as Record<string, unknown>;
		const name = asString(item.name);
		if (!name) return [];
		return [{ name, args: item.args, id: asString(item.id) }];
	});
}

/**
 * Stateful mapper: de-duplicates conversation_id announcements and normalizes
 * streaming chunks regardless of whether the server sends deltas or cumulative
 * partial content.
 */
export class ConversationEventMapper {
	private conversationId: string | undefined;
	private streamedText = '';
	private lastRequestId: string | undefined;
	// approval_required carries no toolCalls of its own; it follows the
	// TOOL_CALL_IN_PROGRESS for the tool being gated, so remember those.
	private lastToolCalls: ApprovalTool[] = [];

	map(raw: RawConversationPayload | null | undefined): ConversationEvent[] {
		if (!raw) return [];
		const events: ConversationEvent[] = [];

		const conversationId = asString(raw.conversation_id);
		if (conversationId && conversationId !== this.conversationId) {
			this.conversationId = conversationId;
			events.push({ kind: 'conversation', conversationId });
		}

		const status = raw.status ?? '';
		const metadata = raw.metadata ?? undefined;

		switch (status) {
			case 'request_registered': {
				const requestId = asString(metadata?.requestId);
				if (requestId) {
					this.lastRequestId = requestId;
					events.push({ kind: 'registered', requestId });
				}
				break;
			}
			case 'approval_required': {
				const parsed = parseApprovalTools(metadata);
				events.push({
					kind: 'approval',
					tools: parsed.length > 0 ? parsed : this.lastToolCalls,
					requestId: asString(metadata?.requestId) ?? this.lastRequestId,
					raw: metadata ?? {},
				});
				break;
			}
			case 'streaming_response': {
				const chunk = this.normalizeChunk(asString(metadata?.partialContent));
				if (chunk) events.push({ kind: 'chunk', text: chunk });
				break;
			}
			case 'TOOL_CALL_IN_PROGRESS': {
				const tools = parseApprovalTools(metadata);
				if (tools.length > 0) this.lastToolCalls = tools;
				events.push({ kind: 'status', label: `Running tool: ${tools[0]?.name ?? 'unknown'}…` });
				break;
			}
			case 'complete': {
				events.push({
					kind: 'complete',
					content: asString(raw.message?.content) ?? this.streamedText,
					sources: parseSources(metadata),
					conversationId: this.conversationId,
					messageId: asString(raw.message?.id),
				});
				break;
			}
			case 'error': {
				events.push({ kind: 'error', message: this.errorMessage(raw) });
				break;
			}
			default: {
				const terminal = TERMINAL_ERROR_MESSAGES[status];
				if (terminal) {
					events.push({ kind: 'error', message: terminal });
					break;
				}
				const label = STATUS_LABELS[status];
				if (label) events.push({ kind: 'status', label });
				// Unknown / ignored statuses are dropped (forward-compatible)
				break;
			}
		}

		return events;
	}

	private normalizeChunk(partialContent: string | undefined): string | undefined {
		if (!partialContent) return undefined;
		// Cumulative payloads repeat everything streamed so far; emit only the suffix.
		if (this.streamedText && partialContent.startsWith(this.streamedText)) {
			const delta = partialContent.slice(this.streamedText.length);
			this.streamedText = partialContent;
			return delta.length > 0 ? delta : undefined;
		}
		this.streamedText += partialContent;
		return partialContent;
	}

	private errorMessage(raw: RawConversationPayload): string {
		if (typeof raw.error === 'string' && raw.error.length > 0) return raw.error;
		if (raw.error != null) return JSON.stringify(raw.error);
		return 'The Rewst AI assistant returned an error.';
	}
}
