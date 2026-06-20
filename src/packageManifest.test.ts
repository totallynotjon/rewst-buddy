import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import { chatCapabilities } from './capabilities';
import { ALL_TOOL_SPECS, APPROVAL_TOOL_SPEC } from './ui/chat/model/lmTools';

const { suite, test, setup } = Mocha;

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
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('declares the VS Code chat model provider floor and contribution', () => {
		assert.match(manifest.engines.vscode, /^\^1\.122/);
		// @types/vscode tracks the highest published typings (>= 1.120), which already
		// contain the LanguageModelChatProvider API (finalized 1.104); the engine floor
		// stays at 1.122 for the signed-out runtime. See DECISIONS.md "Decoupling".
		assert.match(manifest.devDependencies['@types/vscode'], /^\^1\.(1[2-9]\d|[2-9]\d\d)/);
		assert.deepStrictEqual(manifest.contributes.languageModelChatProviders, [
			{
				vendor: 'rewst-buddy',
				displayName: 'Cage-Free Rewsty',
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

	test('every chat-exposed capability is declared as a languageModelTools entry', () => {
		const declared = new Map((manifest.contributes.languageModelTools ?? []).map(tool => [tool.name, tool]));
		for (const capability of chatCapabilities()) {
			const entry = declared.get(capability.spec.name);
			assert.ok(entry, `package.json declares ${capability.spec.name}`);
			assert.strictEqual(
				entry.modelDescription,
				capability.spec.description,
				`${capability.spec.name} description in sync`,
			);
			assert.deepStrictEqual(
				entry.inputSchema,
				capability.spec.inputSchema,
				`${capability.spec.name} inputSchema in sync`,
			);
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
