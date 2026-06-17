// Interactive scaffold for a changelog note — `npm run changelog:new`.
// Dependency-free: uses Node's built-in readline. Detects the PR/issue number
// from `gh` or the branch name so the filename and (#N) link fill themselves in.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

import { CATEGORY_ORDER, NOTES_DIR, canonicalCategory } from './lib.mjs';

function tryExec(cmd, cmdArgs) {
	try {
		return execFileSync(cmd, cmdArgs, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return '';
	}
}

function detectNumber() {
	const fromGh = tryExec('gh', ['pr', 'view', '--json', 'number', '-q', '.number']);
	if (/^\d+$/.test(fromGh)) {
		return fromGh;
	}
	const branch = tryExec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
	const m = branch.match(/(?:issue|pr|fix|feat)[/-](\d+)/i) ?? branch.match(/(\d+)/);
	return m ? m[1] : '';
}

function slugify(text) {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'change'
	);
}

// Line reader that works for both a TTY (waits per prompt) and a pipe (queues
// lines that arrive before they're awaited, instead of dropping them).
function makeAsker() {
	const rl = createInterface({ input: stdin });
	const queue = [];
	const waiters = [];
	let closed = false;
	rl.on('line', line => (waiters.length ? waiters.shift()(line) : queue.push(line)));
	rl.on('close', () => {
		closed = true;
		while (waiters.length) waiters.shift()(null);
	});
	const ask = prompt => {
		stdout.write(prompt);
		if (queue.length) return Promise.resolve(queue.shift());
		if (closed) return Promise.resolve(null);
		return new Promise(resolve => waiters.push(resolve));
	};
	return { ask, close: () => rl.close() };
}

const COMMON = ['Added', 'Changed', 'Fixed']; // the three rewst-buddy uses in practice
const { ask, close } = makeAsker();

try {
	const detected = detectNumber();

	stdout.write('\nCategory:\n');
	COMMON.forEach((c, i) => stdout.write(`  ${i + 1}) ${c}\n`));
	stdout.write(`  4) other (${CATEGORY_ORDER.filter(c => !COMMON.includes(c)).join(', ')})\n`);
	const catChoice = ((await ask('Choose [1]: ')) ?? '').trim() || '1';
	let category;
	if (catChoice === '4') {
		const raw = ((await ask('Category name: ')) ?? '').trim();
		const canon = canonicalCategory(raw);
		if (!canon) {
			console.error(`"${raw}" is not a valid category (expected one of ${CATEGORY_ORDER.join(', ')}). Aborting.`);
			process.exit(1);
		}
		category = canon;
	} else {
		category = COMMON[Number(catChoice) - 1] ?? 'Added';
	}

	const summary = ((await ask('One-line summary: ')) ?? '').trim();
	if (!summary) {
		console.error('A summary is required. Aborting.');
		process.exit(1);
	}

	const numAnswer = ((await ask(`PR/issue number${detected ? ` [${detected}]` : ' (optional)'}: `)) ?? '').trim();
	const number = (numAnswer || detected).replace(/[^\d]/g, '');

	const filename = number ? `${number}.md` : `${slugify(summary)}.md`;
	const filepath = `${NOTES_DIR}/${filename}`;

	if (existsSync(filepath)) {
		const ok = ((await ask(`${filepath} exists — overwrite? [y/N]: `)) ?? '').trim().toLowerCase();
		if (ok !== 'y' && ok !== 'yes') {
			console.log('Aborted.');
			process.exit(0);
		}
	}

	const frontmatter = [`category: ${category}`];
	if (number) {
		frontmatter.push(`pr: ${number}`);
	}
	const bullet = summary.startsWith('-') ? summary : `- ${summary}`;
	const contents = `---\n${frontmatter.join('\n')}\n---\n\n${bullet}\n`;

	await mkdir(NOTES_DIR, { recursive: true });
	await writeFile(filepath, contents);
	console.log(`\nCreated ${filepath}:\n\n${contents}`);
	console.log('Edit it to add detail or nested bullets, then commit it with your change.');
} finally {
	close();
}
