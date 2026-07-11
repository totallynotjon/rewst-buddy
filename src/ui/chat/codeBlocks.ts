export interface CodeBlock {
	language?: string;
	content: string;
}

// CommonMark fences: opening run of 3+ backticks or tildes, indented up to 3
// spaces, closed by a same-indent-or-less run of the same character at least
// as long. Backreference keeps a 4-backtick block from being terminated by a
// ``` inside its content.
const FENCE = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^ {0,3}\1[`~]*[ \t]*$/gm;

/** Extracts fenced code blocks from a markdown answer. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	for (const match of markdown.matchAll(FENCE)) {
		const language = match[2].trim() || undefined;
		const content = match[3].replace(/\r?\n$/, '');
		if (content.trim().length > 0) {
			blocks.push({ language, content });
		}
	}
	return blocks;
}
