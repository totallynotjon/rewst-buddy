/**
 * Renders a stored Rewst conversation (fetched over the HTTP getConversation
 * query) as chat markdown for the @rewst /resume command. Pure so it can be
 * unit tested without a session.
 */

export interface TranscriptMessage {
	role: string;
	content: string;
}

export const TRANSCRIPT_MESSAGE_CAP = 20;
export const TRANSCRIPT_CHAR_CAP = 10_000;

export function formatConversationTranscript(title: string | undefined, messages: TranscriptMessage[]): string {
	// SYSTEM/TOOL messages are plumbing, not conversation.
	const visible = messages.filter(message => message.role === 'USER' || message.role === 'ASSISTANT');
	if (visible.length === 0) return 'This conversation has no messages yet.';

	let shown = visible.slice(-TRANSCRIPT_MESSAGE_CAP);
	let chars = shown.reduce((sum, message) => sum + message.content.length, 0);
	while (shown.length > 1 && chars > TRANSCRIPT_CHAR_CAP) {
		chars -= shown[0].content.length;
		shown = shown.slice(1);
	}

	const parts: string[] = [];
	parts.push(`**Resumed conversation${title ? `: ${title}` : ''}**`);
	if (shown.length < visible.length) {
		parts.push(`*(showing the last ${shown.length} of ${visible.length} messages)*`);
	}
	for (const message of shown) {
		parts.push(message.role === 'USER' ? `**You:** ${message.content}` : message.content);
	}
	parts.push('*Follow-up questions in this chat continue this conversation.*');
	return parts.join('\n\n---\n\n');
}

/** Picker label: stored title, else the opening question, trimmed to one line. */
export function conversationLabel(title: string | null | undefined, firstUserMessage: string | undefined): string {
	const source = title?.trim() || firstUserMessage?.trim() || '(untitled conversation)';
	const oneLine = source.replace(/\s+/g, ' ');
	return oneLine.length > 60 ? oneLine.slice(0, 57) + '…' : oneLine;
}
