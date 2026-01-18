/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const path = require('path');
const glob = require('glob');

/**@type {import('webpack').Configuration}*/
const aliases = {
	'@models': path.resolve(__dirname, 'src/models/index.ts'),
	'@commands': path.resolve(__dirname, 'src/commands/index.ts'),
	'@sessions': path.resolve(__dirname, 'src/sessions/index.ts'),
	'@utils': path.resolve(__dirname, 'src/utils/index.ts'),
	'@global': path.resolve(__dirname, 'src/context/index.ts'),
	'@ui': path.resolve(__dirname, 'src/ui/index.ts'),
	'@server': path.resolve(__dirname, 'src/server/index.ts'),
	'@events': path.resolve(__dirname, 'src/events/index.ts'),
	'@test': path.resolve(__dirname, 'src/test/helpers/index.ts'),
};

/**@type {import('webpack').Configuration}*/
const config = {
	target: 'node', // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

	entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
	output: {
		// the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
		path: path.resolve(__dirname, 'dist'),
		filename: 'extension.js',
		libraryTarget: 'commonjs2',
		devtoolModuleFilenameTemplate: '../[resource-path]',
	},
	devtool: 'source-map',
	externals: {
		vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
	},
	resolve: {
		// support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
		extensions: ['.ts', '.js'],
		alias: aliases,
		modules: ['node_modules'],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: ['ts-loader'],
			},
		],
	},
	stats: {
		errorDetails: true,
	},
	cache: {
		type: 'filesystem',
	},
	optimization: {
		usedExports: true,
	},
};

/**
 * Auto-discover test files using glob patterns.
 * Unit tests: colocated throughout src/ (*.test.ts, excluding helpers and integration)
 * Integration tests: centralized in src/test/integration/
 */
function getTestEntries() {
	const entries = {};

	// Unit tests: colocated throughout src/ (exclude helpers and integration)
	const unitTests = glob.sync('src/**/*.test.ts', {
		ignore: ['src/test/helpers/**', 'src/test/integration/**'],
	});

	for (const file of unitTests) {
		const key = `unit/${file.replace('src/', '').replace('.ts', '')}`;
		entries[key] = './' + file;
	}

	// Integration tests: centralized
	const integrationTests = glob.sync('src/test/integration/*.test.ts');
	for (const file of integrationTests) {
		const key = `integration/${path.basename(file, '.ts')}`;
		entries[key] = './' + file;
	}

	return entries;
}

/**@type {import('webpack').Configuration}*/
const testConfig = {
	...config,
	entry: getTestEntries(),
	output: {
		path: path.resolve(__dirname, 'dist/test'),
		filename: '[name].js',
		libraryTarget: 'commonjs2',
		devtoolModuleFilenameTemplate: '../../[resource-path]',
	},
	externals: {
		...config.externals,
		mocha: 'commonjs mocha',
	},
	resolve: {
		...config.resolve,
		alias: aliases,
	},
};

module.exports = [config, testConfig];
