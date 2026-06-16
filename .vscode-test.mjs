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
	} catch {
		return env; // no .env file — fine
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

export default defineConfig({
	files: 'dist/test/**/*.test.js',
	version: 'stable',
	// Forwarded to the extension host as extensionTestsEnv, merged over process.env.
	env: loadDotEnv(),
	mocha: {
		ui: 'bdd',
		timeout: 60000,
		color: true,
	},
});
