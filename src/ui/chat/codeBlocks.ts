export interface CodeBlock {
	language?: string;
	content: string;
}

// CommonMark fences: opening run of 3+ backticks at line start, closed by a
// line-start run at least as long. Backreference keeps a 4-backtick block from
// being terminated by a ``` inside its content.
const FENCE = /^(`{3,})([^\n]*)\n([\s\S]*?)^\1`*[ \t]*$/gm;

/** Extracts fenced code blocks from a markdown answer. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	for (const match of markdown.matchAll(FENCE)) {
		const language = match[2].trim() || undefined;
		const content = match[3].replace(/\n$/, '');
		if (content.trim().length > 0) {
			blocks.push({ language, content });
		}
	}
	return blocks;
}
