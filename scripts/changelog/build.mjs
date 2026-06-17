// Roll every pending `changelog.d/` note into a single CHANGELOG.md section and
// remove the consumed notes. Run at release time (by the release workflow or
// /merge_release), once, for as many merged PRs as have accumulated.
//
//   node scripts/changelog/build.mjs --version 0.45.0 [--date 2026-06-20]
//   node scripts/changelog/build.mjs --version 0.45.0 --preview   # print, don't write
//   node scripts/changelog/build.mjs --version 0.45.0 --keep      # keep note files
//
// Exit codes: 0 ok / nothing to do, 1 on bad notes or missing --version.

import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NOTES_DIR, loadNotes, renderSection, today, validateNote } from './lib.mjs';

function parseArgs(argv) {
	const args = { preview: false, keep: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--preview') args.preview = true;
		else if (a === '--keep') args.keep = true;
		else if (a === '--version') args.version = argv[++i];
		else if (a === '--date') args.date = argv[++i];
		else if (a === '--changelog') args.changelog = argv[++i];
		else if (a.startsWith('--version=')) args.version = a.slice('--version='.length);
		else if (a.startsWith('--date=')) args.date = a.slice('--date='.length);
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.version) {
	console.error('error: --version <x.y.z> is required');
	process.exit(1);
}
const version = args.version.replace(/^v/, '');
const date = args.date ?? today();
const changelogPath = args.changelog ?? 'CHANGELOG.md';

const notes = await loadNotes();
if (notes.length === 0) {
	console.log(`No notes in ${NOTES_DIR}/ — nothing to release.`);
	process.exit(0);
}

const errors = notes.flatMap(validateNote);
if (errors.length) {
	console.error('Invalid release notes:');
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

const section = renderSection(notes, version, date);

if (args.preview) {
	console.log(section);
	process.exit(0);
}

const changelog = await readFile(changelogPath, 'utf8');
const marker = changelog.indexOf('\n## [');
let updated;
if (marker === -1) {
	const withHeader = changelog.replace(/^(# Changelog\s*\n)/, (_, h) => `${h}\n${section}\n`);
	updated = withHeader === changelog ? `${changelog.trimEnd()}\n\n${section}\n` : withHeader;
} else {
	updated = changelog.slice(0, marker + 1) + section + '\n' + changelog.slice(marker + 1);
}
await writeFile(changelogPath, updated);

if (!args.keep) {
	await Promise.all(notes.map(n => unlink(join(NOTES_DIR, n.name))));
}

console.log(
	`Wrote ${changelogPath} section [${version}] from ${notes.length} note(s)` +
		(args.keep ? '' : ` and removed them from ${NOTES_DIR}/`) +
		'.',
);
