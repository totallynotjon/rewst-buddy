import * as assert from 'assert';
import * as Mocha from 'mocha';
import { ALL_TOOL_SPECS, APPROVAL_TOOL_SPEC } from './ui/chat/model/lmTools';

const { suite, test } = Mocha;

interface ManifestTool {
	name: string;
	modelDescription: string;
	inputSchema: object;
}

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
		languageModelTools?: ManifestTool[];
		chatParticipants?: unknown[];
		commands: { command: string; title: string }[];
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

	test('declares every tool spec as a languageModelTools entry, name-for-name', () => {
		const declared = new Map((manifest.contributes.languageModelTools ?? []).map(tool => [tool.name, tool]));
		const specs = [...ALL_TOOL_SPECS, APPROVAL_TOOL_SPEC];
		assert.strictEqual(declared.size, specs.length, 'declaration count matches the spec arrays');
		for (const spec of specs) {
			const entry = declared.get(spec.name);
			assert.ok(entry, `package.json declares ${spec.name}`);
			assert.strictEqual(entry.modelDescription, spec.description, `${spec.name} description in sync`);
			assert.deepStrictEqual(entry.inputSchema, spec.inputSchema, `${spec.name} inputSchema in sync`);
		}
	});

	test('the @rewst chat participant is retired', () => {
		assert.strictEqual(manifest.contributes.chatParticipants, undefined);
	});

	test('resume and apply commands are contributed for the palette', () => {
		const ids = manifest.contributes.commands.map(entry => entry.command);
		assert.ok(ids.includes('rewst-buddy.prefix.ResumeRewstAiConversation'));
		assert.ok(ids.includes('rewst-buddy.prefix.ApplyRewstAiEdit'));
	});
});
