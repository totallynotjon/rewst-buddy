// Integration tests for build.mjs — the release-critical collation logic
// (CHANGELOG insertion, note cleanup, preview, validation) that lives in the
// script itself rather than lib.mjs. Each test runs the script in a temp dir.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const buildScript = fileURLToPath(new URL('./build.mjs', import.meta.url));

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), 'cl-build-'));
	mkdirSync(join(dir, 'changelog.d'));
	return dir;
}

test('build.mjs collates notes above the latest section and removes them', () => {
	const dir = fixture();
	try {
		writeFileSync(
			join(dir, 'CHANGELOG.md'),
			'# Changelog\n\n## [1.0.0] - 2025-01-01\n\n### Added\n\n- Old thing\n',
		);
		writeFileSync(join(dir, 'changelog.d', '7.md'), '---\ncategory: Fixed\npr: 7\n---\n\n- Fixed the thing\n');
		writeFileSync(join(dir, 'changelog.d', 'README.md'), 'readme, ignored\n');

		execFileSync('node', [buildScript, '--version', '1.1.0', '--date', '2026-02-03'], {
			cwd: dir,
		});

		const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
		assert.ok(
			changelog.indexOf('## [1.1.0] - 2026-02-03') < changelog.indexOf('## [1.0.0]'),
			'new section should be inserted above the previous one',
		);
		assert.match(changelog, /### Fixed\n\n- Fixed the thing \(#7\)/);
		assert.equal(existsSync(join(dir, 'changelog.d', '7.md')), false, 'note consumed');
		assert.equal(existsSync(join(dir, 'changelog.d', 'README.md')), true, 'README kept');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('build.mjs --preview prints without writing or deleting', () => {
	const dir = fixture();
	try {
		const original = '# Changelog\n\n## [1.0.0] - 2025-01-01\n\n### Added\n\n- Old\n';
		writeFileSync(join(dir, 'CHANGELOG.md'), original);
		writeFileSync(join(dir, 'changelog.d', '8.md'), '---\ncategory: Added\npr: 8\n---\n\n- New\n');

		const out = execFileSync('node', [buildScript, '--version', '1.1.0', '--preview'], {
			cwd: dir,
			encoding: 'utf8',
		});
		assert.match(out, /## \[1\.1\.0\]/);
		assert.match(out, /- New \(#8\)/);
		assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), original, 'unchanged');
		assert.equal(existsSync(join(dir, 'changelog.d', '8.md')), true, 'note kept');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('build.mjs rejects an invalid note with a nonzero exit', () => {
	const dir = fixture();
	try {
		writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
		writeFileSync(join(dir, 'changelog.d', 'bad.md'), '---\ncategory: Nonsense\n---\n\n- broken\n');
		assert.throws(
			() =>
				execFileSync('node', [buildScript, '--version', '1.0.0'], {
					cwd: dir,
					encoding: 'utf8',
					stdio: 'pipe',
				}),
			err =>
				typeof err === 'object' &&
				err !== null &&
				'status' in err &&
				err.status !== 0 &&
				/Invalid release notes/.test(String(err.stderr ?? '')),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
