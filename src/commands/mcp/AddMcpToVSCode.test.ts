import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { _resetMcpTokenForTesting } from '@mcp';
import { initTestEnvironment } from '@test';
import { AddMcpToVSCode } from './AddMcpToVSCode';

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

suite('Unit: AddMcpToVSCode', () => {
	const restores: Restore[] = [];
	let infoMessages: string[] = [];
	let infoChoice: string | undefined;
	let availableCommands: string[] = [];
	let executed: string[] = [];

	setup(async () => {
		initTestEnvironment();
		await _resetMcpTokenForTesting();
		infoMessages = [];
		infoChoice = undefined;
		availableCommands = [];
		executed = [];
		await setMcpEnabled(undefined);

		restores.push(
			stub(vscode.window, 'showInformationMessage', (async (message: string, ...items: string[]) => {
				infoMessages.push(message);
				// Only the first (action-bearing) prompt returns the choice.
				return items.length ? infoChoice : undefined;
			}) as unknown as typeof vscode.window.showInformationMessage),
			stub(vscode.commands, 'getCommands', (async () => availableCommands) as typeof vscode.commands.getCommands),
			stub(vscode.commands, 'executeCommand', (async (command: string) => {
				executed.push(command);
				return undefined;
			}) as unknown as typeof vscode.commands.executeCommand),
		);
	});

	teardown(async () => {
		while (restores.length) restores.pop()!.restore();
		await _resetMcpTokenForTesting();
		await setMcpEnabled(undefined);
	});

	test('enables MCP when off and reports it registered the server', async () => {
		await setMcpEnabled(false);
		await new AddMcpToVSCode().execute();

		assert.strictEqual(readMcpEnabled(), true, 'turns the MCP server on');
		assert.ok(
			infoMessages.some(message => message.includes('Enabled')),
			'message notes it enabled the server',
		);
	});

	test('keeps MCP on when already enabled', async () => {
		await setMcpEnabled(true);
		await new AddMcpToVSCode().execute();

		assert.strictEqual(readMcpEnabled(), true, 'leaves the setting on');
		assert.ok(
			infoMessages.some(message => message.includes('registered')),
			'message confirms registration without re-enabling',
		);
	});

	test('Open MCP Servers runs the first available MCP list command', async () => {
		await setMcpEnabled(true);
		availableCommands = ['workbench.mcp.listServer'];
		infoChoice = 'Open MCP Servers';
		await new AddMcpToVSCode().execute();

		assert.deepStrictEqual(executed, ['workbench.mcp.listServer'], 'opens the MCP server list');
	});

	test('falls back to a palette hint when no MCP list command exists', async () => {
		await setMcpEnabled(true);
		availableCommands = [];
		infoChoice = 'Open MCP Servers';
		await new AddMcpToVSCode().execute();

		assert.deepStrictEqual(executed, [], 'does not dispatch an unknown command');
		assert.ok(
			infoMessages.some(message => message.includes('Command Palette')),
			'points the user at the palette command instead',
		);
	});
});
