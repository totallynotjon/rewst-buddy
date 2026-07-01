import { Server } from '@server';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import net from 'net';
import vscode from 'vscode';
import { StartServer } from './StartServer';

const { suite, test, setup, teardown } = Mocha;

/** Binds an ephemeral port, reads it, releases it — a free port to target. */
function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});
}

async function setPort(port: number): Promise<void> {
	const config = vscode.workspace.getConfiguration('rewst-buddy.server');
	await config.update('port', port, vscode.ConfigurationTarget.Global);
}

/**
 * `rewst-buddy.server.enabled` defaults on, and Server.ts auto-restarts on any
 * `rewst-buddy.server.*` config change while enabled and not running. Forcing it
 * off here keeps `setPort` below from racing a config-driven restart, so the
 * manual-start path under test (which works regardless of `enabled`, per the
 * "Manual start" spec scenario) is the only thing flipping the server's status.
 */
async function setEnabled(enabled: boolean | undefined): Promise<void> {
	const config = vscode.workspace.getConfiguration('rewst-buddy.server');
	await config.update('enabled', enabled, vscode.ConfigurationTarget.Global);
}

interface Restore {
	restore(): void;
}

function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): Restore {
	const original = obj[key];
	Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
	return {
		restore() {
			Object.defineProperty(obj, key, { value: original, configurable: true, writable: true });
		},
	};
}

suite('Unit: StartServer command', () => {
	let port = 0;
	let infoMessages: string[] = [];
	const restores: Restore[] = [];

	setup(async () => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		// Activation may still have a background start() in flight (server.enabled
		// defaults on); start() shares that in-flight bind rather than racing it, so
		// awaiting it here settles activation before we stop for a clean, known state.
		await Server.start();
		await Server.stop();
		await setEnabled(false);
		port = await findFreePort();
		await setPort(port);
		infoMessages = [];
		restores.push(
			stub(vscode.window, 'showInformationMessage', (async (message: string) => {
				infoMessages.push(message);
				return undefined;
			}) as unknown as typeof vscode.window.showInformationMessage),
		);
	});

	teardown(async () => {
		while (restores.length) restores.pop()!.restore();
		await Server.stop();
		await setPort(undefined as unknown as number); // clear override
		await setEnabled(undefined); // clear override
	});

	test('starts the server when it is not already running', async () => {
		assert.strictEqual(Server.getStatus(), false, 'precondition: server is not running');

		await new StartServer().execute();

		assert.strictEqual(Server.getStatus(), true, 'server is running after StartServer');
		assert.ok(
			infoMessages.some(message => message.includes('Server started')),
			'reports the server started',
		);
	});

	test('does nothing and reports already running when the server is already started', async () => {
		await Server.start();
		infoMessages = [];

		await new StartServer().execute();

		assert.strictEqual(Server.getStatus(), true);
		assert.ok(
			infoMessages.some(message => message.includes('already running')),
			'reports the server was already running',
		);
	});
});
