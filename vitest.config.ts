import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { vitestSuites } from './vitest.suites.mjs';

/**
 * Runs the pure unit suites listed in vitest.suites.mjs — fast, parallel, no
 * VS Code extension host. esbuild.mjs excludes the same list from the electron
 * test bundle, so every test runs in exactly one runner. Suites that touch
 * `vscode` or the `@test` helpers stay on vscode-test (see CLAUDE.md Testing).
 */
export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		environment: 'node',
		include: vitestSuites,
	},
});
