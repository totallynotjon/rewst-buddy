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

const baseConfig = {
	files: 'dist/test/**/*.test.js',
	version: 'stable',
	launchArgs: ['--disable-chromium-sandbox', '--no-sandbox'],
	mocha: {
		ui: 'bdd',
		timeout: 60000,
		color: true,
	},
};

export default defineConfig([
	{
		...baseConfig,
		label: 'unit',
		env: {},
		mocha: {
			...baseConfig.mocha,
			grep: 'Unit:',
		},
	},
	{
		...baseConfig,
		label: 'integration',
		// Forwarded to the extension host as extensionTestsEnv, merged over process.env.
		env: loadDotEnv(),
		mocha: {
			...baseConfig.mocha,
			grep: 'Integration:',
		},
	},
	// Grep-dedicated labels: a config-level mocha.grep silently wins over the
	// CLI --grep flag, so targeted runs (test:grep / test:grep:integration) need
	// configs that leave grep unset. Never run these labels without --grep.
	{
		...baseConfig,
		label: 'grep',
		env: {},
	},
	{
		...baseConfig,
		label: 'grep-integration',
		env: loadDotEnv(),
	},
]);
