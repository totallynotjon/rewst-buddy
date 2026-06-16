import { defineConfig } from '@vscode/test-cli';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load a local, gitignored `.env` (see `.env.example`) so integration tests can
 * pick up REWST_TEST_TOKEN without exporting it every run. Dependency-free.
 * A real exported environment variable always wins over the file.
 */
function loadDotEnv() {
	const path = join(dirname(fileURLToPath(import.meta.url)), '.env');
	const env = {};
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (error) {
		// A missing .env is fine; surface anything else (e.g. permission denied)
		// rather than silently reporting REWST_TEST_TOKEN as absent.
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
			return env;
		}
		throw error;
	}
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		// Don't override an already-exported variable.
		if (key && process.env[key] === undefined) env[key] = value;
	}
	return env;
}

/**
 * Only feed the .env token to integration runs. `test:unit` must stay offline
 * and fast: without a token the integration suites skip themselves, so unit runs
 * never make network calls regardless of how mocha's --grep filter is applied.
 */
function wantsIntegration() {
	if (process.env.npm_lifecycle_event === 'test:integration') return true;
	if (process.env.REWST_TEST_INTEGRATION === '1') return true;
	return process.argv.some(arg => arg.includes('Integration'));
}

export default defineConfig({
	files: 'dist/test/**/*.test.js',
	version: 'stable',
	// Forwarded to the extension host as extensionTestsEnv, merged over process.env.
	env: wantsIntegration() ? loadDotEnv() : {},
	mocha: {
		ui: 'bdd',
		timeout: 60000,
		color: true,
	},
});
