// Unit tests for the changelog tooling core. The new/check/build scripts are
// thin I/O wrappers around these pure functions, so testing lib.mjs covers the
// substantive logic. Run with `npm run test:changelog` (Node's built-in runner).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_NOTE_WORDS, canonicalCategory, parseNote, renderSection, validateNote } from './lib.mjs';

test('canonicalCategory: canonical names pass through', () => {
	assert.equal(canonicalCategory('Added'), 'Added');
	assert.equal(canonicalCategory('Fixed'), 'Fixed');
	assert.equal(canonicalCategory('Security'), 'Security');
});

test('canonicalCategory: case-insensitive and autocorrected synonyms', () => {
	assert.equal(canonicalCategory('added'), 'Added');
	assert.equal(canonicalCategory('Feature'), 'Added');
	assert.equal(canonicalCategory('bugfix'), 'Fixed');
	assert.equal(canonicalCategory('Enhancement'), 'Changed');
});

test('canonicalCategory: unknown and empty return null', () => {
	assert.equal(canonicalCategory('Wat'), null);
	assert.equal(canonicalCategory(''), null);
	assert.equal(canonicalCategory(undefined), null);
});

test('parseNote: reads category and pr from frontmatter', () => {
	const note = parseNote('---\ncategory: Added\npr: 42\n---\n\n- Did a thing\n', '42.md');
	assert.equal(note.category, 'Added');
	assert.equal(note.pr, 42);
	assert.equal(note.body, '- Did a thing');
});

test('parseNote: strips quotes and tolerates CRLF', () => {
	const note = parseNote('---\r\ncategory: "Fixed"\r\n---\r\n\r\n- Fixed it\r\n', 'x.md');
	assert.equal(note.category, 'Fixed');
	assert.equal(note.body, '- Fixed it');
});

test('parseNote: no frontmatter leaves category null and keeps body', () => {
	const note = parseNote('- just a body\n', 'slug.md');
	assert.equal(note.category, null);
	assert.equal(note.pr, null);
	assert.equal(note.body, '- just a body');
});

test('validateNote: flags missing/invalid category and empty body', () => {
	assert.deepEqual(validateNote({ name: 'a.md', category: 'Added', pr: 1, body: '- x' }), []);
	assert.equal(validateNote({ name: 'b.md', category: null, body: '- x' }).length, 1);
	assert.equal(validateNote({ name: 'c.md', category: 'Nope', body: '- x' }).length, 1);
	assert.equal(validateNote({ name: 'd.md', category: 'Added', body: '' }).length, 1);
});

test('validateNote: a body at the word cap passes, one word over fails', () => {
	const words = n => '- ' + Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
	assert.deepEqual(validateNote({ name: 'ok.md', category: 'Added', body: words(MAX_NOTE_WORDS) }), []);
	const errs = validateNote({ name: 'long.md', category: 'Added', body: words(MAX_NOTE_WORDS + 1) });
	assert.equal(errs.length, 1);
	assert.match(errs[0], /too long|words/i);
});

test('validateNote: bullet markers and em dashes do not count toward the word cap', () => {
	// `- ` and `—` carry no word characters; `**Lead**` is one word. So this body
	// counts as exactly MAX_NOTE_WORDS (one lead + filler) and is not penalised.
	const body = '- **Lead** — ' + Array.from({ length: MAX_NOTE_WORDS - 1 }, (_, i) => `w${i}`).join(' ');
	assert.deepEqual(validateNote({ name: 'dash.md', category: 'Fixed', body }), []);
});

test('renderSection: orders categories and appends the PR link once', () => {
	const notes = [
		{ name: '2.md', category: 'Fixed', pr: 2, body: '- Fix B' },
		{ name: '1.md', category: 'Added', pr: 1, body: '- Add A' },
	];
	const section = renderSection(notes, '1.2.3', '2026-06-20');
	assert.match(section, /^## \[1\.2\.3\] - 2026-06-20\n/);
	assert.ok(section.indexOf('### Added') < section.indexOf('### Fixed'));
	assert.match(section, /- Add A \(#1\)/);
	assert.match(section, /- Fix B \(#2\)/);
});

test('renderSection: does not double-append an existing PR ref', () => {
	const section = renderSection(
		[{ name: '5.md', category: 'Changed', pr: 5, body: '- Tweak (#5)' }],
		'0.0.1',
		'2026-01-01',
	);
	assert.equal((section.match(/\(#5\)/g) || []).length, 1);
});

test('renderSection: preserves nested bullets and omits empty categories', () => {
	const section = renderSection(
		[{ name: '7.md', category: 'Added', pr: 7, body: '- Lead\n    - nested' }],
		'0.1.0',
		'2026-02-02',
	);
	assert.match(section, /- Lead \(#7\)\n {4}- nested/);
	assert.doesNotMatch(section, /### Fixed/);
});
