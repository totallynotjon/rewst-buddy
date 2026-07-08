/**
 * Anthropic SSE event encoding.
 * Pure module — no vscode imports.
 */

/**
 * Encodes one Anthropic SSE event.
 * Returns `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
 */
export function sseEvent(type: string, data: unknown): string {
	return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
