import * as assert from 'assert';
import http from 'http';
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

async function setHost(host: string | undefined): Promise<void> {
	const config = vscode.workspace.getConfiguration('rewst-buddy.server');
	await config.update('host', host, vscode.ConfigurationTarget.Global);
}

/**
 * `rewst-buddy.server.enabled` defaults on, and Server.ts's own config listener
 * auto-restarts on any `rewst-buddy.server.*` change while enabled and not
 * running. Forcing it off keeps `setPort`/`setHost` below from racing that
 * auto-restart, so the explicit `Server.start()` call under test is the only
 * thing that binds.
 */
async function setEnabled(enabled: boolean | undefined): Promise<void> {
	const config = vscode.workspace.getConfiguration('rewst-buddy.server');
	await config.update('enabled', enabled, vscode.ConfigurationTarget.Global);
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

/**
 * Closes the "Run a localhost-only server when enabled" gap: a non-loopback
 * `rewst-buddy.server.host` must be refused before bind() ever calls listen().
 */
suite('Unit: Server host validation', () => {
	const restores: Restore[] = [];
	let errorMessages: string[] = [];

	setup(async () => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		await Server.start(); // settle any in-flight activation bind first
		await Server.stop();
		await setEnabled(false); // avoid the config listener auto-restarting mid-setup below
		errorMessages = [];
		restores.push(
			stub(vscode.window, 'showErrorMessage', (async (message: string) => {
				errorMessages.push(message);
				return undefined;
			}) as unknown as typeof vscode.window.showErrorMessage),
		);
	});

	teardown(async () => {
		while (restores.length) restores.pop()!.restore();
		await Server.stop();
		await setPort(undefined as unknown as number); // clear override
		await setHost(undefined); // clear override
		await setEnabled(undefined); // clear override
	});

	test('refuses to bind a non-loopback host and does not flip isRunning', async () => {
		const port = await findFreePort();
		await setPort(port);
		await setHost('0.0.0.0');

		const started = await Server.start();

		assert.strictEqual(started, false, 'start() should refuse a non-loopback host');
		assert.strictEqual(Server.getStatus(), false, 'server should not be marked running');
		assert.ok(
			errorMessages.some(message => message.toLowerCase().includes('localhost')),
			'user is notified that only localhost bindings are allowed',
		);
	});

	test('refuses an unresolvable hostname', async () => {
		const port = await findFreePort();
		await setPort(port);
		await setHost('attacker.example');

		const started = await Server.start();

		assert.strictEqual(started, false);
		assert.strictEqual(Server.getStatus(), false);
	});
});

interface RawHttpResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
}

/** Sends a real HTTP request via Node's http.request, overriding the Host/Origin headers a browser or proxy could send. */
function rawRequest(options: {
	port: number;
	method: string;
	headers?: Record<string, string>;
	body?: string;
}): Promise<RawHttpResponse> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: '127.0.0.1', port: options.port, method: options.method, path: '/', headers: options.headers },
			res => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					const headers: Record<string, string> = {};
					for (const [key, value] of Object.entries(res.headers)) {
						if (typeof value === 'string') headers[key] = value;
					}
					resolve({
						statusCode: res.statusCode ?? 0,
						headers,
						body: Buffer.concat(chunks).toString('utf-8'),
					});
				});
			},
		);
		req.on('error', reject);
		if (options.body) req.write(options.body);
		req.end();
	});
}

/**
 * Sends a hand-crafted HTTP request over a raw socket. Used only for shapes
 * Node's http.request can't produce on its own — e.g. a request with no Host
 * header at all (Node always injects one unless told otherwise).
 */
function rawSocketRequest(options: {
	port: number;
	requestLine: string;
	headerLines?: string[];
	body?: string;
}): Promise<RawHttpResponse> {
	return new Promise((resolve, reject) => {
		const body = options.body ?? '';
		const headerLines = [...(options.headerLines ?? []), 'Connection: close'];
		if (body) headerLines.push(`Content-Length: ${Buffer.byteLength(body)}`);
		const raw = [options.requestLine, ...headerLines, '', body].join('\r\n');

		const socket = net.createConnection({ host: '127.0.0.1', port: options.port }, () => {
			socket.write(raw);
		});

		let data = '';
		socket.on('data', (chunk: Buffer) => {
			data += chunk.toString('utf-8');
		});
		socket.on('end', () => {
			const [headPart, ...rest] = data.split('\r\n\r\n');
			const headLines = headPart.split('\r\n');
			const statusCode = Number(headLines[0].split(' ')[1]);
			const headers: Record<string, string> = {};
			for (const line of headLines.slice(1)) {
				const idx = line.indexOf(':');
				if (idx === -1) continue;
				headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
			}
			resolve({ statusCode, headers, body: rest.join('\r\n\r\n') });
		});
		socket.on('error', reject);
	});
}

/**
 * Closes the "Reject non-local HTTP requests" gap for the session-ingestion and
 * template-open routes. Exercises the spec's four scenarios against a real,
 * bound Server instance over real HTTP/TCP — the /mcp route's own allowedHosts
 * mechanism is untouched and out of scope here.
 */
suite('Unit: Server request guard (Host/CORS)', () => {
	let port = 0;
	const restores: Restore[] = [];

	setup(async () => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		await Server.start(); // settle any in-flight activation bind first
		await Server.stop();
		await setEnabled(false); // keep the config listener from racing the explicit start() below
		port = await findFreePort();
		await setPort(port);
		await setHost(undefined); // default loopback host
		await Server.start();
	});

	teardown(async () => {
		while (restores.length) restores.pop()!.restore();
		await Server.stop();
		await setPort(undefined as unknown as number);
		await setHost(undefined);
		await setEnabled(undefined);
	});

	test('rejects a non-local Host header before any action runs', async () => {
		const createSessionCalls: unknown[] = [];
		restores.push(
			stub(SessionManager, 'createSession', (async (...args: unknown[]) => {
				createSessionCalls.push(args);
				throw new Error('should not have been called');
			}) as typeof SessionManager.createSession),
		);

		const res = await rawRequest({
			port,
			method: 'POST',
			headers: { Host: 'attacker.example', 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'addSession', cookies: 'cookie=value' }),
		});

		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(createSessionCalls.length, 0, 'no credential/action handling ran for a spoofed Host');
	});

	test('rejects a request with no Host header before reading the request body', async () => {
		const res = await rawSocketRequest({ port, requestLine: 'GET / HTTP/1.0' });

		assert.strictEqual(res.statusCode, 400);
	});

	test('rejects a request with a malformed Host header', async () => {
		const res = await rawSocketRequest({
			port,
			requestLine: 'POST / HTTP/1.1',
			headerLines: ['Host: foo:bar:baz', 'Content-Type: application/json'],
			body: JSON.stringify({ action: 'addSession', cookies: 'cookie=value' }),
		});

		assert.strictEqual(res.statusCode, 400);
	});

	test('rejects a browser request whose Origin is a non-loopback web origin', async () => {
		const res = await rawRequest({
			port,
			method: 'POST',
			headers: {
				Host: `127.0.0.1:${port}`,
				Origin: 'http://attacker.example',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ action: 'addSession', cookies: 'cookie=value' }),
		});

		assert.strictEqual(res.statusCode, 400);
	});

	test('a local preflight names the allowed origin instead of a wildcard', async () => {
		const res = await rawRequest({
			port,
			method: 'OPTIONS',
			headers: { Host: `127.0.0.1:${port}`, Origin: 'http://localhost:5500' },
		});

		assert.notStrictEqual(res.headers['access-control-allow-origin'], '*');
		assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:5500');
	});
});
