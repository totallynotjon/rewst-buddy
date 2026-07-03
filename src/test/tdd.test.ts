/**
 * Guard: every file that imports from '../test/tdd' must be listed in
 * vitestSuites, and every entry in vitestSuites must import from tdd.
 *
 * This prevents a file from accidentally running in the electron runner
 * (where `vitest` is not available) or from being silently excluded from
 * both runners.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { suite, test } from './tdd';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Parse vitestSuites from the .mjs source file using a regex.
 * This avoids any module-loading machinery (require can't load .mjs;
 * dynamic import needs top-level await) and works in all module modes.
 */
function loadVitestSuites(): string[] {
	const src = fs.readFileSync(path.join(ROOT, 'vitest.suites.mjs'), 'utf8');
	// Match every single- or double-quoted string inside the array literal.
	const matches = src.match(/['"]([^'"]+\.test\.ts)['"]/g);
	if (!matches) {
		throw new Error('Could not parse vitestSuites from vitest.suites.mjs');
	}
	return matches.map(m => m.slice(1, -1));
}

const vitestSuites = loadVitestSuites();

/** Recursively collect all *.test.ts files under src/. */
function collectTestFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectTestFiles(full));
		} else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
			results.push(full);
		}
	}
	return results;
}

/** Return true if the file has a real import statement that imports from the tdd module.
 * Strips block comments first so JSDoc references to the path don't count.
 */
function importsTdd(filePath: string): boolean {
	// Remove block comments (/** ... */ and /* ... */) before testing so that
	// documentation references to the tdd path don't produce false positives.
	const src = fs.readFileSync(filePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	// Matches both sibling imports ("./tdd", "../tdd") and path imports ("../test/tdd", "../../test/tdd").
	return /^\s*import\b[^;]+from\s+['"](?:\.{1,2}\/)*(?:test\/)?tdd['"]/mu.test(src);
}

suite('Guard: vitest suites ↔ tdd importers are in sync', () => {
	const srcDir = path.join(ROOT, 'src');
	const allTestFiles = collectTestFiles(srcDir);

	// Normalise vitestSuites to absolute paths for comparison.
	const suiteAbsPaths = new Set<string>(vitestSuites.map(s => path.join(ROOT, s)));

	test('every file that imports tdd is listed in vitestSuites', () => {
		const tddImporters = allTestFiles.filter(importsTdd);
		const unlisted = tddImporters.filter(f => !suiteAbsPaths.has(f));
		assert.deepStrictEqual(
			unlisted.map(f => path.relative(ROOT, f)),
			[],
			'These files import tdd but are not in vitestSuites — add them or move them to the electron runner',
		);
	});

	test('every vitestSuites entry imports tdd', () => {
		const notImportingTdd = [...suiteAbsPaths].filter(f => fs.existsSync(f) && !importsTdd(f));
		assert.deepStrictEqual(
			notImportingTdd.map(f => path.relative(ROOT, f)),
			[],
			'These vitestSuites entries do not import tdd — they may be running in the wrong runner',
		);
	});

	test('every vitestSuites entry exists on disk', () => {
		const missing = [...suiteAbsPaths].filter(f => !fs.existsSync(f));
		assert.deepStrictEqual(
			missing.map(f => path.relative(ROOT, f)),
			[],
			'These vitestSuites entries do not exist on disk',
		);
	});
});
