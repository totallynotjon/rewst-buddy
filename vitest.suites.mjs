/**
 * Test suites that run under vitest (fast, no VS Code extension host) instead
 * of the mocha/electron runner. Shared by esbuild.mjs (which EXCLUDES these
 * from the electron test bundle) and vitest.config.ts (which INCLUDES exactly
 * these), so every test file runs in exactly one runner.
 *
 * Only pure suites belong here: no `vscode` import anywhere in the file's
 * transitive module graph, and no `@test` helpers (they touch the extension
 * host). Everything else stays on the electron runner.
 */
export const vitestSuites = [
	'src/models/syncDecision.test.ts',
	'src/providers/templatePatternUtils.test.ts',
	'src/utils/getHash.test.ts',
	'src/capabilities/inputHelpers.test.ts',
	'src/sessions/conversation/conversationEvents.test.ts',
];
