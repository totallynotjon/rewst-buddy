// Integration tests for check.mjs — the PR gate. Runs the script in a throwaway
// git repo so the git-diff detection, validation, and local-ref fallback (no
// `origin` remote here) are exercised end to end.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const checkScript = fileURLToPath(new URL('./check.mjs', import.meta.url));

function git(cwd, ...args) {
	execFileSync('git', args, { cwd, stdio: 'pipe' });
}

// A repo with a `main` base commit, checked out on a fresh `feat` branch.
function repo() {
	const dir = mkdtempSync(join(tmpdir(), 'cl-check-'));
	git(dir, 'init', '-q');
	git(dir, 'config', 'user.email', 'test@example.com');
	git(dir, 'config', 'user.name', 'Test');
	git(dir, 'config', 'commit.gpgsign', 'false');
	mkdirSync(join(dir, 'changelog.d'));
	writeFileSync(join(dir, 'changelog.d', 'README.md'), 'readme\n');
	writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
	git(dir, 'add', '.');
	git(dir, 'commit', '-q', '-m', 'base');
	git(dir, 'branch', '-M', 'main');
	git(dir, 'checkout', '-q', '-b', 'feat');
	return dir;
}

function runCheck(dir) {
	return execFileSync('node', [checkScript, '--base', 'main'], {
		cwd: dir,
		stdio: 'pipe',
		encoding: 'utf8',
	});
}

test('check.mjs passes when a valid note is added on the branch', () => {
	const dir = repo();
	try {
		writeFileSync(join(dir, 'changelog.d', '5.md'), '---\ncategory: Added\npr: 5\n---\n\n- A change\n');
		git(dir, 'add', '.');
		git(dir, 'commit', '-q', '-m', 'add note');
		assert.doesNotThrow(() => runCheck(dir));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('check.mjs fails when no note is added', () => {
	const dir = repo();
	try {
		writeFileSync(join(dir, 'unrelated.txt'), 'x\n');
		git(dir, 'add', '.');
		git(dir, 'commit', '-q', '-m', 'no note');
		assert.throws(() => runCheck(dir));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('check.mjs fails when an added note is invalid', () => {
	const dir = repo();
	try {
		writeFileSync(join(dir, 'changelog.d', 'bad.md'), '---\ncategory: Bogus\n---\n\n- nope\n');
		git(dir, 'add', '.');
		git(dir, 'commit', '-q', '-m', 'bad note');
		assert.throws(() => runCheck(dir));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
