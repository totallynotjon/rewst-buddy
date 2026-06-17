// Integration tests for new.mjs — the interactive scaffold. Runs the script in
// a temp dir (not a git repo, so number detection is a no-op) and feeds answers
// on stdin, asserting the written note and the invalid-category abort.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const newScript = fileURLToPath(new URL('./new.mjs', import.meta.url));

function runNew(dir, input) {
	return execFileSync('node', [newScript], {
		cwd: dir,
		input,
		stdio: 'pipe',
		encoding: 'utf8',
	});
}

test('new.mjs writes a note named for the PR number', () => {
	const dir = mkdtempSync(join(tmpdir(), 'cl-new-'));
	try {
		runNew(dir, '1\nAdded a thing\n42\n');
		const body = readFileSync(join(dir, 'changelog.d', '42.md'), 'utf8');
		assert.match(body, /category: Added/);
		assert.match(body, /pr: 42/);
		assert.match(body, /- Added a thing/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('new.mjs falls back to a slug filename without a number', () => {
	const dir = mkdtempSync(join(tmpdir(), 'cl-new-'));
	try {
		runNew(dir, '3\nFixed the thing\n\n');
		const body = readFileSync(join(dir, 'changelog.d', 'fixed-the-thing.md'), 'utf8');
		assert.match(body, /category: Fixed/);
		assert.doesNotMatch(body, /pr:/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('new.mjs aborts on an invalid custom category', () => {
	const dir = mkdtempSync(join(tmpdir(), 'cl-new-'));
	try {
		// Feed a full set of answers so the run would succeed if the category
		// were accepted; the failure must come from category validation, not a
		// later "summary required" abort.
		assert.throws(
			() => runNew(dir, '4\nBogus\nAdded anyway\n123\n'),
			err => /not a valid category/i.test(String(err.stderr)),
		);
		assert.equal(existsSync(join(dir, 'changelog.d')), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
