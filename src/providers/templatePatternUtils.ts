export const TEMPLATE_PATTERN =
	/template\s*\(\s*["']([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})["']\s*\)/g;

export interface TemplateMatch {
	templateId: string;
	startChar: number;
	endChar: number;
}

export function findTemplateAtPosition(line: string, character: number): TemplateMatch | null {
	TEMPLATE_PATTERN.lastIndex = 0; // Reset for fresh match
	let match: RegExpExecArray | null;

	while ((match = TEMPLATE_PATTERN.exec(line)) !== null) {
		const start = match.index;
		const end = start + match[0].length;

		if (character >= start && character <= end) {
			return {
				templateId: match[1],
				startChar: start,
				endChar: end,
			};
		}
	}

	return null;
}
