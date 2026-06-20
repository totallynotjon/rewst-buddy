import * as assert from 'assert';
import * as Mocha from 'mocha';
import net from 'net';
import vscode from 'vscode';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import { Server } from './Server';

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
 * Regression: activation calls Server.start() twice in quick succession
 * (Server.init + McpServerController.init). Both used to open their own listen
 * on the same port before isRunning flipped true; the loser's EADDRINUSE handler
 * tore down the server the winner had just bound. start() now shares one
 * in-flight bind, so concurrent calls don't collide.
 */
suite('Unit: Server concurrent start', () => {
	let port = 0;

	setup(async () => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		await Server.stop(); // ensure a clean, not-running singleton
		port = await findFreePort();
		await setPort(port);
	});

	teardown(async () => {
		await Server.stop();
		await setPort(undefined as unknown as number); // clear override
	});

	test('two concurrent start() calls leave the server running, not torn down', async () => {
		let sawStopped = false;
		const sub = Server.onDidChangeStatus(running => {
			if (!running) sawStopped = true;
		});

		try {
			const [a, b] = await Promise.all([Server.start(), Server.start()]);

			assert.strictEqual(a, true, 'first start should succeed');
			assert.strictEqual(b, true, 'second concurrent start should succeed (shared bind)');
			assert.strictEqual(Server.getStatus(), true, 'server should remain running');
			assert.strictEqual(sawStopped, false, 'no self-collision teardown should fire a stopped status');
		} finally {
			sub.dispose();
		}
	});
});
