export interface CodeBlock {
	language?: string;
	content: string;
}

const FENCE = /```([^\n]*)\n([\s\S]*?)```/g;

/** Extracts fenced code blocks from a markdown answer. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	for (const match of markdown.matchAll(FENCE)) {
		const language = match[1].trim() || undefined;
		const content = match[2].replace(/\n$/, '');
		if (content.trim().length > 0) {
			blocks.push({ language, content });
		}
	}
	return blocks;
}
