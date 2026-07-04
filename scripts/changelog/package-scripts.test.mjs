import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('local changelog test runs the same PR gate as CI', () => {
	assert.equal(pkg.scripts['test:changelog:tools'], 'node --test scripts/changelog/*.test.mjs');
	assert.match(pkg.scripts['test:changelog:ci'], /node scripts\/changelog\/check\.mjs/);
	assert.match(pkg.scripts['test:changelog:ci'], /--base main/);
	assert.match(pkg.scripts['test:changelog:ci'], /--include-working-tree/);
	assert.match(pkg.scripts['test:changelog'], /npm run test:changelog:tools/);
	assert.match(pkg.scripts['test:changelog'], /npm run test:changelog:ci/);
});

test('CI keeps tooling tests and PR gate aligned with local scripts', () => {
	assert.match(ci, /run: npm run test:changelog:tools/);
	assert.match(ci, /run: node scripts\/changelog\/check\.mjs/);
});
