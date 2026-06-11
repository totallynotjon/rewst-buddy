/**
 * The most recent final RoboRewsty answer, kept so the apply-to-file command
 * can offer its code blocks without a chat-response button channel (model
 * providers cannot render buttons).
 */
let lastAnswer: string | undefined;

export function setLastAiAnswer(content: string): void {
	lastAnswer = content;
}

export function getLastAiAnswer(): string | undefined {
	return lastAnswer;
}
