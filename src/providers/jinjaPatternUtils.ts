export interface JinjaSpan {
	start: number;
	end: number;
}

export interface JinjaFilterTrigger {
	/** Filter name typed so far after the triggering pipe, e.g. '' or 'up'. */
	partial: string;
}

export interface JinjaKeywordToken {
	keyword: string;
	start: number;
	end: number;
}

const JINJA_KEYWORDS = new Set(['try', 'catch', 'endtry', 'for', 'endfor', 'in', 'if', 'elif', 'else', 'endif']);
const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;
const FILTER_NAME_PATTERN = /\|\s*([A-Za-z_][A-Za-z0-9_]*)/g;

/** Finds every `{{ }}`/`{% %}` span on a single line. An unclosed span runs to end of line; a span closed by the wrong delimiter type (e.g. `{{` closed by `%}`) is not a valid span at all. */
function findJinjaSpans(line: string): JinjaSpan[] {
	const spans: JinjaSpan[] = [];
	let i = 0;
	while (i < line.length) {
		if (line.startsWith('{{', i) || line.startsWith('{%', i)) {
			const isExpr = line.startsWith('{{', i);
			const contentStart = i + 2;
			const matchClose = isExpr ? '}}' : '%}';
			const otherClose = isExpr ? '%}' : '}}';
			const matchIdx = line.indexOf(matchClose, contentStart);
			const otherIdx = line.indexOf(otherClose, contentStart);
			if (matchIdx !== -1 && (otherIdx === -1 || matchIdx <= otherIdx)) {
				spans.push({ start: contentStart, end: matchIdx });
				i = matchIdx + 2;
				continue;
			}
			if (otherIdx !== -1) {
				i = contentStart;
				continue;
			}
			spans.push({ start: contentStart, end: line.length });
			i = line.length;
			continue;
		}
		i++;
	}
	return spans;
}

function findEnclosingJinjaSpan(line: string, character: number): JinjaSpan | null {
	return findJinjaSpans(line).find(span => character >= span.start && character <= span.end) ?? null;
}

/** Returns `content` with quoted string literals blanked out (same length/offsets), honoring `\`-escaped quotes. */
function blankQuotedLiterals(content: string): string {
	const chars = content.split('');
	let quote: string | null = null;
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		if (quote) {
			if (ch === '\\' && i + 1 < chars.length) {
				chars[i] = ' ';
				chars[i + 1] = ' ';
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			chars[i] = ' ';
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			chars[i] = ' ';
		}
	}
	return chars.join('');
}

/** Last `|` before `to`, ignoring pipes inside single/double-quoted string literals. */
function lastUnquotedPipeIndex(line: string, from: number, to: number): number {
	const idx = blankQuotedLiterals(line.slice(from, to)).lastIndexOf('|');
	return idx === -1 ? -1 : from + idx;
}

/** Detects a filter-completion trigger: cursor right after `|` (with an optional partial name) inside a Jinja span. */
export function findJinjaFilterTriggerAtPosition(line: string, character: number): JinjaFilterTrigger | null {
	const span = findEnclosingJinjaSpan(line, character);
	if (!span) return null;
	const pipeIdx = lastUnquotedPipeIndex(line, span.start, character);
	if (pipeIdx === -1) return null;
	const partial = line.slice(pipeIdx + 1, character).trim();
	if (!/^\w*$/.test(partial)) return null;
	return { partial };
}

/** Finds the filter name token (immediately after a `|`) containing `character`, for hover. */
export function findJinjaFilterNameAtPosition(line: string, character: number): string | null {
	const span = findEnclosingJinjaSpan(line, character);
	if (!span) return null;
	const content = line.slice(span.start, span.end);
	FILTER_NAME_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = FILTER_NAME_PATTERN.exec(content)) !== null) {
		const nameStart = span.start + match.index + (match[0].length - match[1].length);
		const nameEnd = nameStart + match[1].length;
		if (character >= nameStart && character <= nameEnd) return match[1];
	}
	return null;
}

/** Finds Rewst's Jinja dialect keyword tokens, but only inside `{{ }}`/`{% %}` spans. */
export function findJinjaKeywordTokens(line: string): JinjaKeywordToken[] {
	const tokens: JinjaKeywordToken[] = [];
	for (const span of findJinjaSpans(line)) {
		const content = blankQuotedLiterals(line.slice(span.start, span.end));
		IDENTIFIER_PATTERN.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = IDENTIFIER_PATTERN.exec(content)) !== null) {
			if (JINJA_KEYWORDS.has(match[0])) {
				const start = span.start + match.index;
				tokens.push({ keyword: match[0], start, end: start + match[0].length });
			}
		}
	}
	return tokens;
}
