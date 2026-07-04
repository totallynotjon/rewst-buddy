import * as esbuild from 'esbuild';
import { glob } from 'glob';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Logs build start/end (and errors in a problem-matcher friendly format) so the
 * VS Code watch task can consume it via the esbuild problem matcher
 * (connor4312.esbuild-problem-matchers).
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd(result => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log('[watch] build finished');
		});
	},
};

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'es2020',
	sourcemap: true,
	sourcesContent: false,
	minify: production,
	// Command registration and logging reference class/function names at
	// runtime; keep them intact when minifying.
	keepNames: true,
	// ws optionally requires these native addons in a try/catch; leave them
	// unresolved. vscode is provided by the extension host.
	external: ['vscode', 'bufferutil', 'utf-8-validate'],
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
	...sharedOptions,
	entryPoints: ['src/extension.ts'],
	outfile: 'dist/extension.js',
};

/**
 * Auto-discover test files and bundle them as one entry, mirroring the mocha
 * suite layout: unit tests are colocated throughout src/, integration tests
 * are centralized in src/test/integration/. Suites listed in
 * vitest.suites.mjs run under vitest instead and are excluded here so every
 * test runs in exactly one runner.
 */
async function buildTestIndex() {
	const { vitestSuites } = await import('./vitest.suites.mjs');
	const unitTests = glob.sync('src/**/*.test.ts', {
		ignore: ['src/test/helpers/**', 'src/test/integration/**', ...vitestSuites],
	});
	const integrationTests = glob.sync('src/test/integration/**/*.test.ts');
	const files = [...unitTests, ...integrationTests].sort();
	return files.map(file => `import './${path.relative('src', file).replace(/\\/g, '/')}';`).join('\n');
}

/** @type {() => Promise<import('esbuild').BuildOptions>} */
async function testOptions() {
	return {
		...sharedOptions,
		stdin: {
			contents: await buildTestIndex(),
			resolveDir: path.join(rootDir, 'src'),
			sourcefile: 'index.test.ts',
			loader: 'ts',
		},
		outfile: 'dist/test/index.test.js',
		external: [...sharedOptions.external, 'mocha'],
	};
}

async function main() {
	const buildOptions = [extensionOptions];
	if (!production) {
		// The test bundle is regenerated from the current glob results; drop
		// stale output from previous layouts (webpack emitted one bundle/file).
		fs.rmSync(path.join(rootDir, 'dist/test'), { recursive: true, force: true });
		buildOptions.push(await testOptions());
	}

	const contexts = await Promise.all(buildOptions.map(opts => esbuild.context(opts)));

	if (watch) {
		await Promise.all(contexts.map(ctx => ctx.watch()));
	} else {
		await Promise.all(contexts.map(ctx => ctx.rebuild()));
		await Promise.all(contexts.map(ctx => ctx.dispose()));
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
