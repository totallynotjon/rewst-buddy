import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import * as Commands from './commands/exportedCommands';
import GenericCommand, { createCommand } from './commands/GenericCommand';

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
		configuration?: {
			properties?: Record<string, { type?: string; default?: unknown; description?: string }>;
		};
		commands: { command: string; title: string }[];
		keybindings?: { command: string; key: string; mac?: string }[];
		menus?: {
			commandPalette?: { command: string; when?: string }[];
		};
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

	test('does not contribute Rewst tools as VS Code language-model tools', () => {
		const declared: ManifestTool[] = manifest.contributes.languageModelTools ?? [];
		const names = declared.map(tool => tool.name);
		assert.deepStrictEqual(declared, [], 'languageModelTools contribution is empty');
		assert.ok(!names.some(name => name.startsWith('buddy_')), 'no buddy_* LM tools are contributed');
		assert.ok(
			!names.some(name => name === 'buddy_search_template_links'),
			'buddy_search_template_links is not an LM tool',
		);
	});

	test('the @rewst chat participant is retired', () => {
		assert.strictEqual(manifest.contributes.chatParticipants, undefined);
	});

	test('MCP settings use the three-tier gate and the legacy checklist is removed', () => {
		const properties = manifest.contributes.configuration?.properties ?? {};
		const retiredChecklistKey = ['rewst-buddy', 'ai', 'tools'].join('.');
		assert.strictEqual(properties[retiredChecklistKey], undefined);
		assert.strictEqual(properties['rewst-buddy.mcp.enable']?.default, false);
		assert.strictEqual(properties['rewst-buddy.mcp.enableWriteTools']?.default, false);
		assert.strictEqual(properties['rewst-buddy.mcp.enableDangerousGraphqlMutation']?.default, false);
		assert.match(
			properties['rewst-buddy.mcp.enableDangerousGraphqlMutation']?.description ?? '',
			/arbitrary GraphQL mutations/,
		);
	});

	test('AI settings expose the configurable buddy tool round cap', () => {
		const properties = manifest.contributes.configuration?.properties ?? {};
		const setting = properties['rewst-buddy.ai.maxBuddyToolRounds'];
		assert.strictEqual(setting?.type, 'number');
		assert.strictEqual(setting?.default, 8);
		assert.strictEqual((setting as { minimum?: number }).minimum, 1);
		assert.strictEqual((setting as { maximum?: number }).maximum, 100);
		assert.match(setting?.description ?? '', /tool calls/i);
	});

	test('resume and apply commands are contributed for the palette', () => {
		const ids = manifest.contributes.commands.map(entry => entry.command);
		assert.ok(ids.includes('rewst-buddy.prefix.ResumeRewstAiConversation'));
		assert.ok(ids.includes('rewst-buddy.prefix.ApplyRewstAiEdit'));
	});

	test('Ask Rewst AI is bound to ctrl+alt+r / cmd+alt+r', () => {
		const bindings = manifest.contributes.keybindings ?? [];
		const ask = bindings.find(binding => binding.command === 'rewst-buddy.prefix.AskRewstAI');
		assert.strictEqual(ask?.key, 'ctrl+alt+r');
		assert.strictEqual(ask?.mac, 'cmd+alt+r');
	});

	test('working-scope settings replace the write allowlist and the commands are contributed', () => {
		const properties = manifest.contributes.configuration?.properties ?? {};
		assert.strictEqual(properties['rewst-buddy.mcp.writeOrgAllowlist'], undefined, 'legacy allowlist key removed');
		assert.strictEqual(properties['rewst-buddy.mcp.alwaysAllowedOrgs']?.type, 'array');
		assert.deepStrictEqual(properties['rewst-buddy.mcp.alwaysAllowedOrgs']?.default, []);
		assert.strictEqual(properties['rewst-buddy.mcp.workingOrgScope']?.default, 'strict');

		const ids = manifest.contributes.commands.map(entry => entry.command);
		assert.ok(ids.includes('rewst-buddy.SetWorkingScope'));
		assert.ok(ids.includes('rewst-buddy.ClearWorkingScope'));
	});

	test('Remove Session is contributed and reachable from the palette without an active session', () => {
		const ids = manifest.contributes.commands.map(entry => entry.command);
		assert.ok(ids.includes('rewst-buddy.prefix.RemoveSession'));
		assert.ok(ids.includes('rewst-buddy.RemoveSession'));

		// A known-only (previously authenticated, no longer active) session must
		// still be removable, so the palette entry must not be gated on
		// anyActiveSessions the way ClearSessions is.
		const paletteEntries = manifest.contributes.menus?.commandPalette ?? [];
		const gated = paletteEntries.find(entry => entry.command === 'rewst-buddy.prefix.RemoveSession');
		assert.ok(
			gated === undefined || gated.when === undefined || !gated.when.includes('anyActiveSessions'),
			'Remove Session must stay reachable when only known/inactive sessions exist',
		);
	});

	test('contributed command ids map to exported command registrations', () => {
		const commandTypes = Object.values(Commands) as (new () => GenericCommand)[];
		const registeredIds = new Set(
			commandTypes.flatMap(type => {
				const command = createCommand(type);
				return [`rewst-buddy.${command.commandName}`, `rewst-buddy.prefix.${command.commandName}`];
			}),
		);

		const missing = manifest.contributes.commands
			.map(entry => entry.command)
			.filter(commandId => !registeredIds.has(commandId));

		assert.deepStrictEqual(missing, []);
	});
});
