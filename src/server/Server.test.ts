import { SessionManager } from '@sessions';
import { initTestEnvironment, stub as replaceMethod } from '@test';
import * as assert from 'assert';
import http from 'http';
import * as Mocha from 'mocha';
import net from 'net';
import vscode from 'vscode';
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

async function setMcpEnabled(value: boolean | undefined): Promise<void> {
	await vscode.workspace
		.getConfiguration('rewst-buddy.mcp')
		.update('enable', value, vscode.ConfigurationTarget.Global);
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
	return { restore: replaceMethod(obj, key, impl) };
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
	path?: string;
	headers?: Record<string, string>;
	body?: string;
}): Promise<RawHttpResponse> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port: options.port,
				method: options.method,
				path: options.path ?? '/',
				headers: options.headers,
			},
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

/**
 * Polls the configured port until it answers with the server's method-not-allowed
 * response for GET (405) — proof a rewst-buddy server is listening there — or the
 * timeout elapses. Polling instead of a single request keeps the check
 * instance-agnostic: several bundled Server copies (this test bundle plus the
 * activated extension) share the real config and race for the port, and any
 * winner satisfies the spec's "the server listens" contract.
 */
async function waitForListening(port: number, timeoutMs = 2000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await rawRequest({ port, method: 'GET', headers: { Host: `127.0.0.1:${port}` } });
			if (res.statusCode === 405) return true;
		} catch {
			// not listening yet
		}
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	return false;
}

/**
 * Closes the "Server enabled" and "Kept alive by the MCP bridge" gaps in the
 * credential-server spec's "Run a localhost-only server when enabled"
 * requirement: activation's startIfEnabled() path brings the server up on the
 * validated loopback host/port when `rewst-buddy.server.enabled` is on, and
 * `rewst-buddy.mcp.enable` alone keeps it up while the browser-action server is
 * off (an auto start self-stops via shouldStayRunning() only when no driver
 * wants it).
 */
suite('Unit: Server lifecycle drivers', () => {
	let port = 0;

	setup(async () => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		await Server.start(); // settle any in-flight activation bind first
		await Server.stop();
		await setEnabled(false);
		await setMcpEnabled(false);
		port = await findFreePort();
		await setPort(port);
		await setHost(undefined);
	});

	teardown(async () => {
		await Server.stop();
		await setMcpEnabled(undefined); // MCP off first, so McpServerController's sync stops an MCP-kept copy
		await setEnabled(false); // stops an enabled-driven copy and keeps the resets below from restarting one
		await setPort(undefined as unknown as number); // clear override
		await setHost(undefined); // clear override
		await setEnabled(undefined); // clear override
	});

	test('rewst-buddy.server.enabled brings the server up on the validated loopback host and port', async () => {
		await setEnabled(true);

		await Server.startIfEnabled();

		assert.ok(
			await waitForListening(port),
			'the configured loopback port answers HTTP once the enabled driver is on',
		);
	});

	test('the server stays up when only rewst-buddy.mcp.enable is on', async () => {
		await setMcpEnabled(true);

		// Exercises the auto-start decision path directly; the extension's own
		// McpServerController reacts to the same setting, and either starter
		// satisfies the spec — the port must come up and stay up.
		await Server.start(true);

		assert.ok(await waitForListening(port), 'the MCP driver alone brings the server up');
		await new Promise(resolve => setTimeout(resolve, 100)); // let post-bind reconciliation settle
		const res = await rawRequest({ port, method: 'GET', headers: { Host: `127.0.0.1:${port}` } });
		assert.strictEqual(res.statusCode, 405, 'the server stays up to serve the MCP bridge');
	});

	test('with both drivers off, startIfEnabled is a no-op and an auto start self-stops', async () => {
		await Server.startIfEnabled();
		assert.strictEqual(Server.getStatus(), false, 'startIfEnabled does not start while the enabled driver is off');

		const started = await Server.start(true);

		assert.strictEqual(started, false, 'an auto start with no driver reports not started');
		assert.strictEqual(Server.getStatus(), false, 'the server does not stay up when both drivers are off');
	});

	test('proxy setting alone keeps the server running', async () => {
		await vscode.workspace
			.getConfiguration('rewst-buddy.ai')
			.update('anthropicProxy', true, vscode.ConfigurationTarget.Global);
		try {
			// Auto start: shouldStayRunning() is true because proxy is on
			const started = await Server.start(true);
			assert.ok(started, 'proxy driver alone should keep the server running');
			assert.ok(await waitForListening(port), 'server should be listening when proxy is the only driver');
		} finally {
			await vscode.workspace
				.getConfiguration('rewst-buddy.ai')
				.update('anthropicProxy', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('routes /v1/messages to the proxy handler', async () => {
		await setEnabled(true);
		await Server.startIfEnabled();
		assert.ok(await waitForListening(port), 'server must be up');
		// A request to /v1/messages should get an Anthropic-shaped error response
		// (proxy disabled by default → 403 permission_error), NOT the browser-action
		// pipeline's 400/405 shape.
		const res = await rawRequest({
			port,
			method: 'POST',
			path: '/v1/messages',
			headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] }),
		});
		const body = JSON.parse(res.body) as Record<string, unknown>;
		// Anthropic error shape: { type: 'error', error: { type, message } }
		assert.strictEqual(body?.type, 'error', 'response should have Anthropic error shape');
		assert.ok(
			(body?.error as Record<string, unknown>)?.type === 'permission_error',
			'proxy disabled → permission_error (not browser-action pipeline error)',
		);
	});
});
