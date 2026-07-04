// PR gate: every PR must add at least one `changelog.d/` note, and every note
// in the directory must be valid. Run in CI on pull_request.
//
//   BASE_REF=main node scripts/changelog/check.mjs
//   node scripts/changelog/check.mjs --base main
//   node scripts/changelog/check.mjs --base main --include-working-tree
//
// A PR that genuinely needs no changelog entry should carry the
// `skip-changelog` label — the workflow skips this job for those.

import { execFileSync } from 'node:child_process';

import { NOTES_DIR, loadNotes, validateNote } from './lib.mjs';

function arg(name) {
	const i = process.argv.indexOf(name);
	return i !== -1 ? process.argv[i + 1] : undefined;
}

function hasFlag(name) {
	return process.argv.includes(name);
}

const baseRef = arg('--base') ?? process.env.BASE_REF;
if (!baseRef) {
	console.error('error: set BASE_REF (or pass --base <branch>)');
	process.exit(1);
}
const includeWorkingTree = hasFlag('--include-working-tree');

function git(...gitArgs) {
	return execFileSync('git', gitArgs, { encoding: 'utf8' });
}

let ref = `origin/${baseRef}`;
try {
	git('fetch', '--quiet', 'origin', baseRef);
} catch {
	console.warn(`warning: could not fetch origin/${baseRef}; falling back to local ${baseRef}`);
	ref = baseRef;
}

const diff = git('diff', '--name-only', '--diff-filter=A', `${ref}...HEAD`, '--', `${NOTES_DIR}/`);
function notePaths(raw) {
	return raw
		.split('\n')
		.map(s => s.trim())
		.filter(p => p.endsWith('.md') && !p.toLowerCase().endsWith('readme.md'));
}

const added = new Set(notePaths(diff));
if (includeWorkingTree) {
	for (const p of notePaths(git('diff', '--name-only', '--diff-filter=A', '--cached', '--', `${NOTES_DIR}/`))) {
		added.add(p);
	}
	for (const p of notePaths(git('ls-files', '--others', '--exclude-standard', '--', `${NOTES_DIR}/`))) {
		added.add(p);
	}
}

// Validate every note currently in the directory, not just the added ones —
// a malformed pre-existing note would break the release build.
const errors = (await loadNotes()).flatMap(validateNote);

let failed = false;
if (added.size === 0) {
	console.error(
		`::error::No changelog note added under ${NOTES_DIR}/.\n` +
			`Run "npm run changelog:new" to scaffold one, or add the "skip-changelog" label.`,
	);
	failed = true;
}
if (errors.length) {
	for (const e of errors) console.error(`::error::${e}`);
	failed = true;
}

if (failed) process.exit(1);
console.log(`OK — ${added.size} note(s) added, all notes valid. 🎉`);
