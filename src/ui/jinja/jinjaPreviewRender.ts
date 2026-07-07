/**
 * Pure helpers for the Jinja preview session's render step: parsing the
 * overrides file, merging it over the picked execution's context, and
 * formatting content for the rendered-output pane. No vscode import — kept
 * testable on the vitest runner.
 */

export const OVERRIDES_SEED = [
	"// Add key/value overrides here — merged on top of the picked execution's context.",
	'// Example: { "myVar": "test value" }',
	'{}',
	'',
].join('\n');

export interface OverridesParseResult {
	vars?: Record<string, unknown>;
	error?: string;
}

/**
 * A readable, filesystem/uri-safe base name for the preview's vars/rendered
 * documents — the template's name plus a short id suffix (a stable 8-char
 * slice of the template id, not a hash) so same-named templates don't collide
 * on disk or in the rendered-content-provider's uri map.
 */
export function previewBaseName(templateId: string, templateName: string): string {
	const cleaned = templateName
		.replace(/[\\/:*?"<>|]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const safeName = cleaned.length > 0 ? cleaned : 'template';
	const suffix = templateId.replace(/-/g, '').slice(0, 8) || 'id';
	return `${safeName} (${suffix})`;
}

/**
 * Strips full-line `//` comments (the only comment shape the seed file and
 * expected edits use) and parses the rest as JSON. Not a general jsonc parser —
 * inline trailing comments and block comments aren't supported.
 */
export function parseOverrides(overridesText: string): OverridesParseResult {
	const trimmed = overridesText.trim();
	if (trimmed === '') return { vars: {} };

	const withoutComments = trimmed.replace(/^[ \t]*\/\/.*$/gm, '');
	try {
		const parsed: unknown = JSON.parse(withoutComments);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { error: 'overrides must be a JSON object, e.g. {"myVar": "value"}' };
		}
		return { vars: parsed as Record<string, unknown> };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

/** Overrides win on a shared key, same semantics as mergeExecutionContext's snapshot merge. */
export function mergeVars(
	base: Record<string, unknown> | undefined,
	overrides: Record<string, unknown>,
): Record<string, unknown> {
	return { ...(base ?? {}), ...overrides };
}

export function formatRenderedSuccess(value: unknown, hasControlCharacter: boolean): string {
	const warning = hasControlCharacter
		? "// WARNING — rendered result contains a control character. If this came from regex_replace backreference escaping, use '\\\\1' instead of '\\1'.\n\n"
		: '';
	// A string result renders raw so newlines/quotes show as real text, not
	// JSON-escaped (\n, \") — this is a text preview, not a JS object inspector.
	// Non-string values (objects, arrays, numbers, booleans, null) still get
	// pretty-printed JSON so their structure is foldable/readable.
	const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	return `${warning}${body}`;
}

export function formatRenderedError(message: string): string {
	return `// Error: ${message}`;
}

export function formatInvalidOverrides(message: string): string {
	return `// Invalid overrides JSON: ${message}`;
}
