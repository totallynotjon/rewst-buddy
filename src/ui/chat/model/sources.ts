import type { ConversationSource } from '@sessions';

/**
 * Renders RoboRewsty's answer sources as a markdown section appended to the
 * response text (a model provider has no reference/citation channel — text is
 * the only surface).
 */
export function renderSourcesMarkdown(sources: readonly ConversationSource[]): string {
	if (sources.length === 0) return '';
	const lines = sources.map(source => {
		const section = source.section ? ` — ${source.section}` : '';
		if (/^https?:\/\//.test(source.source)) {
			return `- [${source.label}](${source.source})${section}`;
		}
		return `- ${source.label}${section}`;
	});
	return `\n\n**Sources**\n${lines.join('\n')}\n`;
}
