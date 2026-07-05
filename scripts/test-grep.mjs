#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const pattern = process.argv.slice(2).join(' ').trim();

if (!pattern) {
	console.error('error: provide a grep pattern, e.g. npm run test:grep -- "Unit: package manifest"');
	process.exit(1);
}

function run(command, args) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});

	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

run('npm', ['run', 'compile:test']);
run('vitest', ['run', '--testNamePattern', pattern, '--passWithNoTests']);
run('vscode-test', ['--label', 'grep', '--grep', pattern]);
