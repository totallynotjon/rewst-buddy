import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { Server } from '@server';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import { McpServerController } from './McpServerController';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

/** Replaces one method on a (real) object and returns a restore handle. */
function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): Restore {
	const original = obj[key];
	Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
	return {
		restore() {
			Object.defineProperty(obj, key, { value: original, configurable: true, writable: true });
		},
	};
}

/** Polls a predicate until true or the timeout elapses (sync is fire-and-forget). */
async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await new Promise(resolve => setTimeout(resolve, 15));
	}
	return predicate();
}

async function setMcpEnabled(value: boolean | undefined): Promise<void> {
	await vscode.workspace
		.getConfiguration('rewst-buddy.mcp')
		.update('enable', value, vscode.ConfigurationTarget.Global);
}

/**
 * Tests the controller's contract — does it ask the localhost Server to start
 * when MCP is enabled? — by stubbing Server so no real socket binds. Only
 * `rewst-buddy.mcp.enable` is toggled, so the global Server's own
 * `rewst-buddy.server` config handler never fires and cannot interfere.
 */
suite('Unit: McpServerController', () => {
	const restores: Restore[] = [];
	let running = false;
	let startCalls = 0;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		running = false;
		startCalls = 0;
		restores.push(
			stub(Server, 'getStatus', (() => running) as typeof Server.getStatus),
			stub(Server, 'start', (async () => {
				startCalls += 1;
				running = true;
				return true;
			}) as typeof Server.start),
		);
	});

	teardown(async () => {
		McpServerController.dispose();
		while (restores.length) restores.pop()!.restore();
		await setMcpEnabled(undefined);
	});

	test('does not start the server when MCP is disabled', async () => {
		await setMcpEnabled(false);
		McpServerController.init();
		// Give the fire-and-forget sync a chance to run; it must stay a no-op.
		await new Promise(resolve => setTimeout(resolve, 60));
		assert.strictEqual(startCalls, 0, 'never asks the server to start while MCP is off');
	});

	test('starts the localhost server when MCP is enabled', async () => {
		await setMcpEnabled(true);
		McpServerController.init();
		assert.ok(await waitUntil(() => startCalls > 0), 'asks the server to start when MCP is enabled');
	});

	test('does not start a second time when the server is already running', async () => {
		running = true; // server already bound (e.g. the browser-action server)
		await setMcpEnabled(true);
		McpServerController.init();
		await new Promise(resolve => setTimeout(resolve, 60));
		assert.strictEqual(startCalls, 0, 'reuses the already-running server');
	});

	test('reacts to a later config change that enables MCP', async () => {
		await setMcpEnabled(false);
		McpServerController.init();
		await new Promise(resolve => setTimeout(resolve, 30));
		assert.strictEqual(startCalls, 0, 'starts idle');

		await setMcpEnabled(true);
		assert.ok(await waitUntil(() => startCalls > 0), 'the config-change subscription starts the server');
	});

	test('stops reacting after dispose', async () => {
		await setMcpEnabled(false);
		McpServerController.init();
		McpServerController.dispose();

		await setMcpEnabled(true);
		await new Promise(resolve => setTimeout(resolve, 80));
		assert.strictEqual(startCalls, 0, 'a disposed controller ignores config changes');
	});
});
