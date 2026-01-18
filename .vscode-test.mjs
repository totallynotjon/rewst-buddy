import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'dist/test/**/*.test.js',
	version: 'stable',
	mocha: {
		ui: 'bdd',
		timeout: 60000,
		color: true,
	},
});
