/**
 * Renders a compact unified diff for display in chat ```diff blocks. Display
 * only — never applied as a patch — so a single prefix/suffix-trimmed hunk is
 * enough to show what an edit added and removed.
 */

export interface DiffRenderOptions {
	/** Unchanged lines shown around the change. */
	context?: number;
	/** Cap on rendered lines; the rest collapses into a trailing note. */
	maxLines?: number;
}

export function renderUnifiedDiff(before: string, after: string, options: DiffRenderOptions = {}): string {
	if (before === after) return '';
	const context = options.context ?? 2;
	const maxLines = options.maxLines ?? 60;

	const a = before === '' ? [] : before.split('\n');
	const b = after === '' ? [] : after.split('\n');

	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	) {
		suffix++;
	}

	const removed = a.slice(prefix, a.length - suffix);
	const added = b.slice(prefix, b.length - suffix);
	const contextBefore = a.slice(Math.max(0, prefix - context), prefix);
	const contextAfter = a.slice(a.length - suffix, Math.min(a.length, a.length - suffix + context));

	const lines = [
		...contextBefore.map(line => ` ${line}`),
		...removed.map(line => `-${line}`),
		...added.map(line => `+${line}`),
		...contextAfter.map(line => ` ${line}`),
	];

	const start = Math.max(0, prefix - context) + 1;
	const countA = contextBefore.length + removed.length + contextAfter.length;
	const countB = contextBefore.length + added.length + contextAfter.length;
	const header = `@@ -${start},${countA} +${start},${countB} @@`;

	const body =
		lines.length > maxLines ? [...lines.slice(0, maxLines), `…(+${lines.length - maxLines} more lines)`] : lines;
	return [header, ...body].join('\n');
}

/** One-line summary like "+3 −1" for an edit. */
export function diffStats(before: string, after: string): string {
	const a = before === '' ? [] : before.split('\n');
	const b = after === '' ? [] : after.split('\n');
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	) {
		suffix++;
	}
	return `+${b.length - prefix - suffix} −${a.length - prefix - suffix}`;
}
