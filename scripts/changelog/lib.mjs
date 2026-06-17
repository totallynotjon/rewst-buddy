// Shared helpers for the per-PR changelog-note system.
//
// Each unreleased change adds one file under `changelog.d/`, so two PRs never
// edit the same lines and never conflict. A note is version-agnostic — the
// version is assigned only when `build.mjs` rolls every pending note into a
// single `## [x.y.z]` section in CHANGELOG.md at release time.
//
// Note format (Markdown + YAML-ish frontmatter):
//
//   ---
//   category: Added        # Added | Changed | Fixed | Deprecated | Removed | Security
//   pr: 42                 # optional; otherwise taken from a numeric filename
//   ---
//   - **Lead summary** — the entry exactly as it should read in the changelog.
//       Nested bullets and multiple lines are allowed.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const NOTES_DIR = 'changelog.d';

// "Keep a Changelog" categories, in the order they render in a release section.
export const CATEGORY_ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

const AUTOCORRECT = new Map(
	Object.entries({
		add: 'Added',
		added: 'Added',
		feature: 'Added',
		features: 'Added',
		new: 'Added',
		change: 'Changed',
		changed: 'Changed',
		changes: 'Changed',
		enhancement: 'Changed',
		enhancements: 'Changed',
		improvement: 'Changed',
		improvements: 'Changed',
		deprecate: 'Deprecated',
		deprecated: 'Deprecated',
		remove: 'Removed',
		removed: 'Removed',
		removal: 'Removed',
		fix: 'Fixed',
		fixed: 'Fixed',
		fixes: 'Fixed',
		bug: 'Fixed',
		bugfix: 'Fixed',
		bugfixes: 'Fixed',
		security: 'Security',
	}),
);

export function canonicalCategory(raw) {
	const trimmed = String(raw ?? '').trim();
	if (!trimmed) {
		return null;
	}
	const direct = CATEGORY_ORDER.find(c => c.toLowerCase() === trimmed.toLowerCase());
	return direct ?? AUTOCORRECT.get(trimmed.toLowerCase()) ?? null;
}

// Minimal frontmatter parse — handles the `key: value` lines this format uses
// without pulling in a YAML dependency.
export function parseNote(raw, name) {
	let category = null;
	let pr = null;
	let body = raw;

	const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (fm) {
		body = fm[2];
		for (const line of fm[1].split(/\r?\n/)) {
			const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
			if (!m) {
				continue;
			}
			const key = m[1].toLowerCase();
			const val = m[2].trim().replace(/^["']|["']$/g, '');
			if (key === 'category') {
				category = val;
			} else if (key === 'pr') {
				const digits = val.replace(/[^\d]/g, '');
				pr = digits ? Number(digits) : null;
			}
		}
	}

	return { name, category, pr, body: body.trim() };
}

export async function loadNotes(dir = NOTES_DIR) {
	let entries;
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	const files = entries
		.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

	const notes = [];
	for (const f of files) {
		const note = parseNote(await readFile(join(dir, f), 'utf8'), f);
		if (note.pr == null) {
			const base = f.replace(/\.md$/, '');
			if (/^\d+$/.test(base)) {
				note.pr = Number(base);
			}
		}
		notes.push(note);
	}
	return notes;
}

export function validateNote(note) {
	const errors = [];
	if (!note.category) {
		errors.push(`${note.name}: missing "category" in frontmatter`);
	} else if (!canonicalCategory(note.category)) {
		errors.push(`${note.name}: category "${note.category}" is not one of ${CATEGORY_ORDER.join(', ')}`);
	}
	if (!note.body) {
		errors.push(`${note.name}: empty body`);
	}
	return errors;
}

// Render the collected notes as one CHANGELOG section: `## [version] - date`
// with a `### Category` heading per non-empty category, in canonical order.
export function renderSection(notes, version, date) {
	const byCategory = new Map(CATEGORY_ORDER.map(c => [c, []]));
	for (const note of notes) {
		const category = canonicalCategory(note.category);
		let body = note.body;
		if (note.pr != null) {
			const ref = `(#${note.pr})`;
			const lines = body.split('\n');
			if (!lines[0].includes(ref)) {
				lines[0] = `${lines[0].replace(/\s+$/, '')} ${ref}`;
			}
			body = lines.join('\n');
		}
		byCategory.get(category).push(body);
	}

	const parts = [`## [${version}] - ${date}`];
	for (const category of CATEGORY_ORDER) {
		const items = byCategory.get(category);
		if (items.length) {
			parts.push(`### ${category}\n\n${items.join('\n')}`);
		}
	}
	return `${parts.join('\n\n')}\n`;
}

export function today() {
	return new Date().toISOString().slice(0, 10);
}
