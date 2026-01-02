/**
 * ESLint configuration for the project.
 *
 * See https://eslint.style and https://typescript-eslint.io for additional linting options.
 */
// @ts-check
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['out', 'dist', 'webpack.config.cjs', 'src/sessions/graphql/sdk.ts'],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...tseslint.configs.stylistic,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.node,
				...globals.es2021,
			},
		},
		plugins: {
			'@stylistic': stylistic,
		},
		rules: {
			curly: 'warn',
			'@stylistic/semi': ['warn', 'always'],
			'@stylistic/quotes': ['warn', 'single', { avoidEscape: true }],
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'import',
					format: ['camelCase', 'PascalCase'],
				},
			],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
		},
	},
	prettierConfig,
);
