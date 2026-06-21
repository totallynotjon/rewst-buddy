import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { getMcpToken, _resetMcpTokenForTesting } from '@mcp';
import { initTestEnvironment } from '@test';
import { McpDefinitionProvider } from './McpDefinitionProvider';

const { suite, test, setup, teardown } = Mocha;

async function setMcpEnabled(value: boolean | undefined): Promise<void> {
	await vscode.workspace
		.getConfiguration('rewst-buddy.mcp')
		.update('enable', value, vscode.ConfigurationTarget.Global);
}

async function setServer(key: 'host' | 'enabled', value: unknown): Promise<void> {
	await vscode.workspace.getConfiguration('rewst-buddy.server').update(key, value, vscode.ConfigurationTarget.Global);
}

async function setMcpExposure(
	key: 'enableWriteTools' | 'enableDangerousGraphqlMutation',
	value: boolean | undefined,
): Promise<void> {
	await vscode.workspace.getConfiguration('rewst-buddy.mcp').update(key, value, vscode.ConfigurationTarget.Global);
}

function versionOf(): string {
	const defs = McpDefinitionProvider.provideMcpServerDefinitions();
	return (defs[0] as vscode.McpHttpServerDefinition).version ?? '';
}

suite('Unit: McpDefinitionProvider', () => {
	setup(async () => {
		initTestEnvironment();
		await _resetMcpTokenForTesting();
		// Keep the browser-action server off so a host change can't start a real socket.
		await setServer('enabled', false);
		await setServer('host', undefined);
		await setMcpEnabled(undefined);
	});

	teardown(async () => {
		await _resetMcpTokenForTesting();
		await setMcpEnabled(undefined);
		await setMcpExposure('enableWriteTools', undefined);
		await setMcpExposure('enableDangerousGraphqlMutation', undefined);
		await setServer('enabled', undefined);
		await setServer('host', undefined);
	});

	test('advertises no server while MCP is disabled', async () => {
		await setMcpEnabled(false);
		assert.deepStrictEqual(McpDefinitionProvider.provideMcpServerDefinitions(), []);
	});

	test('advertises the /mcp endpoint with a live Bearer header when enabled', async () => {
		await setMcpEnabled(true);
		const defs = McpDefinitionProvider.provideMcpServerDefinitions();
		assert.strictEqual(defs.length, 1);
		const def = defs[0] as vscode.McpHttpServerDefinition;
		assert.match(def.uri.toString(), /^http:\/\/127\.0\.0\.1:\d+\/mcp$/, 'points at the localhost /mcp route');
		// VS Code is the client, so the live token is injected directly (no env-var hop).
		assert.strictEqual(def.headers.Authorization, `Bearer ${getMcpToken()}`, 'standard Bearer header, live token');
		assert.strictEqual(def.label, 'Rewst Buddy');
	});

	test('brackets an IPv6 host in the endpoint URI', async () => {
		await setServer('host', '::1');
		await setMcpEnabled(true);
		const defs = McpDefinitionProvider.provideMcpServerDefinitions();
		const def = defs[0] as vscode.McpHttpServerDefinition;
		assert.match(def.uri.toString(), /^http:\/\/\[::1\]:\d+\/mcp$/, 'IPv6 host is bracketed');
	});

	test('the advertised version changes when the write/dangerous exposure toggles flip', async () => {
		await setMcpEnabled(true);
		const base = versionOf();

		await setMcpExposure('enableWriteTools', true);
		const withWrite = versionOf();
		assert.notStrictEqual(withWrite, base, 'enabling write tools changes the version so VS Code reconnects');

		await setMcpExposure('enableDangerousGraphqlMutation', true);
		const withDangerous = versionOf();
		assert.notStrictEqual(withDangerous, withWrite, 'enabling the dangerous mutation toggle changes the version');

		await setMcpExposure('enableWriteTools', false);
		await setMcpExposure('enableDangerousGraphqlMutation', false);
		assert.strictEqual(versionOf(), base, 'reverting both toggles restores the original version');
	});

	test('refresh fires the change event so VS Code re-reads the definitions', () => {
		let fired = 0;
		const sub = McpDefinitionProvider.onDidChangeMcpServerDefinitions(() => {
			fired += 1;
		});
		McpDefinitionProvider.refresh();
		sub.dispose();
		assert.strictEqual(fired, 1);
	});
});
