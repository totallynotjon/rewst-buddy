import type { ConversationSource } from '@sessions';

/**
 * Renders RoboRewsty's answer sources as a markdown section appended to the
 * response text (a model provider has no reference/citation channel — text is
 * the only surface).
 */
function escapeMarkdownLinkSyntax(text: string): string {
	return text.replace(/[\\[\]()]/g, '\\$&');
}

export function renderSourcesMarkdown(sources: readonly ConversationSource[]): string {
	if (sources.length === 0) return '';
	const lines = sources.map(source => {
		const label = escapeMarkdownLinkSyntax(source.label);
		const section = source.section ? ` — ${escapeMarkdownLinkSyntax(source.section)}` : '';
		if (/^https?:\/\//i.test(source.source)) {
			return `- [${label}](${source.source})${section}`;
		}
		return `- ${label}${section}`;
	});
	return `\n\n**Sources**\n${lines.join('\n')}\n`;
}
