/**
 * Prompt scaffolding for messages sent to the Rewst AI assistant. (Chat
 * attachments/selections are inlined by the chat UI itself in model-provider
 * mode, so the old reference-resolution helpers are gone.)
 */

/**
 * Prepends the user's standing instructions to a message. Not a real system
 * prompt — RoboRewsty's system prompt is server-side and immutable — but the
 * assistant honors per-message preambles in practice.
 */
export function prependInstructions(message: string, instructions: string | undefined): string {
	const trimmed = instructions?.trim();
	if (!trimmed) return message;
	return `User's standing instructions: ${trimmed}\n\n---\n\n${message}`;
}
