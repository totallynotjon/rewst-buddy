import * as assert from 'assert';
import * as Mocha from 'mocha';

const { suite, test } = Mocha;

interface PackageManifest {
	engines: {
		vscode: string;
	};
	devDependencies: Record<string, string>;
	contributes: {
		languageModelChatProviders?: {
			vendor: string;
			displayName: string;
		}[];
	};
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled JSON load
const manifest = require('../package.json') as PackageManifest;

suite('Unit: package manifest', () => {
	test('declares the VS Code chat model provider floor and contribution', () => {
		assert.match(manifest.engines.vscode, /^\^1\.122/);
		// @types/vscode tracks the highest published typings (>= 1.120), which already
		// contain the LanguageModelChatProvider API (finalized 1.104); the engine floor
		// stays at 1.122 for the signed-out runtime. See DECISIONS.md "Decoupling".
		assert.match(manifest.devDependencies['@types/vscode'], /^\^1\.(1[2-9]\d|[2-9]\d\d)/);
		assert.deepStrictEqual(manifest.contributes.languageModelChatProviders, [
			{
				vendor: 'rewst-buddy',
				displayName: 'RoboRewsty',
			},
		]);
	});
});
