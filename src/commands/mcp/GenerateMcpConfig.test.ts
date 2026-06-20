import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { getMcpToken, _resetMcpTokenForTesting } from '@mcp';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import { GenerateMcpConfig } from './GenerateMcpConfig';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

/** Replaces one method on a (real) vscode object and returns a restore handle. */
function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): Restore {
	const original = obj[key];
	Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
	return {
		restore() {
			Object.defineProperty(obj, key, { value: original, configurable: true, writable: true });
		},
	};
}

async function setMcpEnabled(value: boolean | undefined): Promise<void> {
	await vscode.workspace
		.getConfiguration('rewst-buddy.mcp')
		.update('enable', value, vscode.ConfigurationTarget.Global);
}

function readMcpEnabled(): boolean | undefined {
	return vscode.workspace.getConfiguration('rewst-buddy.mcp').get<boolean>('enable');
}

suite('Unit: GenerateMcpConfig', () => {
	const restores: Restore[] = [];
	let opened: { language?: string; content?: string } | undefined;
	let shownOptions: vscode.TextDocumentShowOptions | undefined;
	let clipboardText: string | undefined;
	let infoMessage: string | undefined;
	let infoItems: string[] = [];
	let infoChoice: string | undefined;

	setup(async () => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		await _resetMcpTokenForTesting();
		opened = undefined;
		shownOptions = undefined;
		clipboardText = undefined;
		infoMessage = undefined;
		infoItems = [];
		infoChoice = undefined;

		restores.push(
			stub(vscode.workspace, 'openTextDocument', (async (options: { language?: string; content?: string }) => {
				opened = options;
				return { uri: vscode.Uri.parse('untitled:mcp-config.json') } as vscode.TextDocument;
			}) as typeof vscode.workspace.openTextDocument),
			stub(vscode.window, 'showTextDocument', (async (_doc: unknown, options: vscode.TextDocumentShowOptions) => {
				shownOptions = options;
				return {} as vscode.TextEditor;
			}) as unknown as typeof vscode.window.showTextDocument),
			// clipboard.writeText is non-configurable, so replace the whole clipboard object.
			stub(vscode.env, 'clipboard', {
				writeText: async (text: string) => {
					clipboardText = text;
				},
				readText: async () => clipboardText ?? '',
			} as vscode.Clipboard),
			stub(vscode.window, 'showInformationMessage', (async (message: string, ...items: string[]) => {
				infoMessage = message;
				infoItems = items;
				return infoChoice;
			}) as unknown as typeof vscode.window.showInformationMessage),
		);
	});

	teardown(async () => {
		while (restores.length) restores.pop()!.restore();
		SessionManager._resetForTesting();
		await _resetMcpTokenForTesting();
		await setMcpEnabled(undefined);
	});

	test('generates a config with the localhost /mcp URL and a Bearer Authorization header', async () => {
		await setMcpEnabled(true);
		await new GenerateMcpConfig().execute();

		assert.strictEqual(opened?.language, 'json');
		const config = JSON.parse(opened!.content!) as {
			mcpServers: Record<
				string,
				{ url: string; headers: Record<string, string>; command?: string; args?: unknown }
			>;
		};
		const server = config.mcpServers['rewst-buddy'];
		assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/, 'points at the localhost /mcp route');
		assert.strictEqual(server.headers.Authorization, `Bearer ${getMcpToken()}`, 'standard Bearer auth header');
		// The in-extension transport means no spawned process and no custom header.
		assert.strictEqual(server.command, undefined, 'no node/spawn command');
		assert.strictEqual(server.args, undefined, 'no bridge args');
		assert.strictEqual(server.headers['x-rewst-mcp-token'], undefined, 'no legacy custom header');
	});

	test('copies the config to the clipboard and opens it without preview', async () => {
		await setMcpEnabled(true);
		await new GenerateMcpConfig().execute();

		assert.ok(clipboardText?.includes('rewst-buddy'), 'clipboard carries the config');
		assert.strictEqual(clipboardText, opened?.content, 'clipboard matches the opened document');
		assert.strictEqual(shownOptions?.preview, false, 'opens as a real (non-preview) editor');
	});

	test('when MCP is enabled, shows the info message without an enable prompt', async () => {
		await setMcpEnabled(true);
		await new GenerateMcpConfig().execute();

		assert.ok(infoMessage?.includes('clipboard'), 'confirms the copy');
		assert.deepStrictEqual(infoItems, [], 'no enable button when already enabled');
		assert.strictEqual(readMcpEnabled(), true, 'leaves the setting on');
	});

	test('when MCP is disabled, offers an enable button and turns it on when chosen', async () => {
		await setMcpEnabled(false);
		infoChoice = 'Enable MCP server';
		await new GenerateMcpConfig().execute();

		assert.ok(infoItems.includes('Enable MCP server'), 'offers the enable button');
		assert.ok(infoMessage?.includes('currently off'), 'notes the server is off');
		assert.strictEqual(readMcpEnabled(), true, 'enables MCP when the button is chosen');
	});

	test('when MCP is disabled and the prompt is dismissed, it stays disabled', async () => {
		await setMcpEnabled(false);
		infoChoice = undefined; // user dismissed the prompt
		await new GenerateMcpConfig().execute();

		assert.ok(infoItems.includes('Enable MCP server'), 'still offers the button');
		assert.notStrictEqual(readMcpEnabled(), true, 'does not enable MCP on dismissal');
	});
});
