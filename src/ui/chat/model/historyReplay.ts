import vscode from 'vscode';

/**
 * Rebuilds a compact transcript of the chat so a NEW backend conversation can
 * be seeded with context the editor still has but the backend does not. Two
 * ways to get here: the in-memory continuity map lost its binding (window
 * reload), or the user rewound the transcript (Restore Checkpoint, editing an
 * earlier message) and the append-only backend conversation had to be forked.
 *
 * Only readable text rides along — tool calls and results are dropped (their
 * callIds mean nothing to a fresh conversation, and outputs can be huge), as
 * are the activity blockquote lines the provider streams. The newest turns
 * matter most, so when over budget whole oldest messages are dropped and the
 * replay says how many.
 */

const MAX_MESSAGE_CHARS = 2_000;
const MAX_TOTAL_CHARS = 12_000;

type RequestMessage = Pick<vscode.LanguageModelChatRequestMessage, 'role' | 'content'>;

function textOf(content: readonly unknown[]): string {
	let out = '';
	for (const part of content) {
		if (typeof part === 'string') out += part;
		else if (typeof (part as { value?: unknown })?.value === 'string') out += (part as { value: string }).value;
	}
	// Activity lines ("> _Searching documentation…_") are streamed meta, not answer text.
	return out.replace(/^> _.*_$/gm, '').trim();
}

export function buildHistoryReplay(messages: readonly RequestMessage[]): string {
	const lines: string[] = [];
	for (const message of messages) {
		const label = message.role === vscode.LanguageModelChatMessageRole.User ? 'USER' : 'ASSISTANT';
		let text = textOf(message.content);
		if (!text) continue;
		if (text.length > MAX_MESSAGE_CHARS) text = `${text.slice(0, MAX_MESSAGE_CHARS)} …(truncated)`;
		lines.push(`${label}: ${text}`);
	}
	if (lines.length === 0) return '';

	let dropped = 0;
	let total = lines.reduce((sum, line) => sum + line.length, 0);
	while (total > MAX_TOTAL_CHARS && lines.length > 1) {
		const removed = lines.shift();
		if (removed === undefined) break;
		total -= removed.length;
		dropped++;
	}

	const omitted = dropped > 0 ? `\n(${dropped} earlier message(s) omitted)` : '';
	return `<chat_transcript_replay>
The editor restored this chat from its transcript; the prior backend conversation is unavailable (reloaded window or a checkpoint rewind). The exchange so far, for context only — do not answer it again. The user's new message follows after this block.${omitted}

${lines.join('\n\n')}
</chat_transcript_replay>`;
}
