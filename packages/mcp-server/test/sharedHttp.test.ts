import { PassThrough } from 'node:stream';
import { runStdioProxy } from '../src/stdioProxy';
import { registerHostCapabilities } from '../src/capabilities/registry';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { createMcpServer } from '../src/mcpServer';
import { discoverSharedServer } from '../src/sharedDiscovery';
import { startSharedHttpServer } from '../src/sharedHttp';
import { configureRuntimeHost } from '../src/host';
import { MemorySecretStore, MemoryStateStore } from '../src/storage';
import { createSharedEditorServer, handleSharedBrowserAction, requestAttachedEditor } from '../src/editorBridge';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()?.();
});

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	await new Promise<void>(resolve => server.close(() => resolve()));
	return port;
}

describe('shared HTTP hub', () => {
	it('rejects a malformed request URL and continues serving clients', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-http-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const port = await freePort();
		const hub = await startSharedHttpServer({ port, discoveryDir: dir, createEditorServer: createMcpServer });
		cleanups.push(() => hub.close());
		const status = await new Promise<number | undefined>((resolve, reject) => {
			const req = request({ host: '127.0.0.1', port, path: '//', timeout: 2_000 }, res => {
				res.on('error', reject);
				res.on('end', () => resolve(res.statusCode));
				res.resume();
			});
			req.on('error', reject);
			req.on('timeout', () => req.destroy(new Error('Malformed request was not answered')));
			req.end();
		});
		expect(status).toBe(400);
		expect((await discoverSharedServer(port, dir))?.instanceId).toBe(hub.descriptor.instanceId);
	});

	it('publishes authenticated identity and removes its record on close', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-http-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const port = await freePort();
		const hub = await startSharedHttpServer({
			port,
			discoveryDir: dir,
			createEditorServer: () => createMcpServer(),
		});
		const found = await discoverSharedServer(port, dir);
		expect(found?.instanceId).toBe(hub.descriptor.instanceId);
		expect((await fetch(`http://127.0.0.1:${port}/mcp`)).status).toBe(401);
		expect(
			(
				await fetch(`http://127.0.0.1:${port}/mcp`, {
					headers: { Authorization: `Bearer ${hub.descriptor.publicToken}`, Origin: 'https://evil.example' },
				})
			).status,
		).toBe(403);
		await hub.close();
		expect(await discoverSharedServer(port, dir)).toBeUndefined();
	});

	it('serves browser actions from an extension origin without MCP auth', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-http-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const port = await freePort();
		const hub = await startSharedHttpServer({
			port,
			discoveryDir: dir,
			createEditorServer: () => createMcpServer(),
			handleBrowserAction: async body => ({ action: body.action, ok: true }),
		});
		const response = await fetch(`http://127.0.0.1:${port}/`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnop' },
			body: JSON.stringify({ action: 'addSession', cookies: 'secret-cookie' }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ action: 'addSession', ok: true });
		await hub.close();
	});

	it('opens a private editor SSE stream with its separate token', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-http-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const port = await freePort();
		const hub = await startSharedHttpServer({
			port,
			discoveryDir: dir,
			createEditorServer: () => createMcpServer(),
		});
		expect(hub.descriptor.editorToken).not.toBe(hub.descriptor.publicToken);
		const init = await fetch(`http://127.0.0.1:${port}/editor`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${hub.descriptor.editorToken}`,
				'content-type': 'application/json',
				Accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
			}),
		});
		expect(init.status).toBe(200);
		const sessionId = init.headers.get('mcp-session-id');
		expect(sessionId).toBeTruthy();
		const response = await fetch(`http://127.0.0.1:${port}/editor`, {
			headers: {
				Authorization: `Bearer ${hub.descriptor.editorToken}`,
				Accept: 'text/event-stream',
				'mcp-session-id': sessionId!,
				'mcp-protocol-version': '2025-06-18',
			},
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		await response.body?.cancel();
		await hub.close();
	});

	it('delivers request-scoped editor notifications before the tool response', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-http-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const port = await freePort();
		const hub = await startSharedHttpServer({
			port,
			discoveryDir: dir,
			createEditorServer: () =>
				createMcpServer({
					extraTools: [
						{
							name: 'rewst_editor_operation',
							description: 'Private editor operation',
							inputSchema: { type: 'object' },
							async run(_input, context) {
								await context.emit({ streamId: 'turn-1', event: { kind: 'chunk', text: 'Hello' } });
								await context.emit({ streamId: 'turn-1', event: { kind: 'complete', content: 'Hello' } });
								return { streamId: 'turn-1' };
							},
						},
					],
				}),
		});
		cleanups.push(() => hub.close());
		const client = new Client({ name: 'editor-stream-test', version: '1' });
		const received: unknown[] = [];
		client.setNotificationHandler(
			z.object({ method: z.literal('notifications/rewst/event'), params: z.object({ event: z.unknown() }) }),
			notification => received.push(notification.params.event),
		);
		const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/editor`), {
			requestInit: { headers: { Authorization: `Bearer ${hub.descriptor.editorToken}` }, redirect: 'error' },
		});
		try {
			await client.connect(transport);
			const result = await client.callTool({ name: 'rewst_editor_operation', arguments: {} });
			expect(result.isError).not.toBe(true);
			expect(received).toEqual([
				{ streamId: 'turn-1', event: { kind: 'chunk', text: 'Hello' } },
				{ streamId: 'turn-1', event: { kind: 'complete', content: 'Hello' } },
			]);
		} finally {
			await transport.terminateSession().catch(() => undefined);
			await client.close().catch(() => undefined);
		}
	});

	it('supports reverse editor requests, token rotation, CORS, and session cleanup', async () => {
		configureRuntimeHost({
			state: new MemoryStateStore(),
			secrets: new MemorySecretStore(),
			getSetting: (_key, fallback) => fallback,
			log() {},
		});
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-http-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const port = await freePort();
		const server = createSharedEditorServer();
		const hub = await startSharedHttpServer({ port, discoveryDir: dir, createEditorServer: () => server });
		const client = new Client({ name: 'real-editor-test', version: '1' });
		client.setRequestHandler(
			z.object({
				method: z.literal('rewst/editor'),
				params: z.object({ operation: z.string(), input: z.record(z.string(), z.unknown()) }),
			}),
			async request => ({ result: { operation: request.params.operation, input: request.params.input } }),
		);
		const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/editor`), {
			requestInit: { headers: { Authorization: `Bearer ${hub.descriptor.editorToken}` }, redirect: 'error' },
		});
		try {
			await client.connect(transport);
			const attached = await client.callTool({
				name: 'rewst_editor_operation',
				arguments: { operation: 'editor.attach', input: { capabilities: [] } },
			});
			expect(attached.isError).not.toBe(true);
			expect(
				await handleSharedBrowserAction({ action: 'openTemplate', orgId: 'org', templateId: 'template' }),
			).toEqual({ operation: 'browser.openTemplate', input: { orgId: 'org', templateId: 'template' } });

			const oldToken = hub.descriptor.publicToken;
			await hub.setPublicToken('rotated-public-token');
			expect(
				(await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { Authorization: `Bearer ${oldToken}` } }))
					.status,
			).toBe(401);
			expect(
				(
					await fetch(`http://127.0.0.1:${port}/mcp`, {
						headers: { Authorization: `Bearer rotated-public-token` },
					})
				).status,
			).not.toBe(401);
			expect((await discoverSharedServer(port, dir))?.publicToken).toBe('rotated-public-token');
			const preflight = await fetch(`http://127.0.0.1:${port}/mcp`, {
				method: 'OPTIONS',
				headers: { Origin: `http://127.0.0.1:${port}` },
			});
			expect(preflight.status).toBe(204);
			expect(preflight.headers.get('access-control-allow-origin')).toBe(`http://127.0.0.1:${port}`);
			expect(
				(
					await fetch(`http://127.0.0.1:${port}/mcp`, {
						method: 'POST',
						headers: {
							Authorization: `Bearer rotated-public-token`,
							'content-type': 'application/json',
							'mcp-session-id': 'missing',
						},
						body: '{}',
					})
				).status,
			).toBe(404);
			expect(
				(
					await fetch(`http://127.0.0.1:${port}/editor`, {
						headers: { Authorization: `Bearer rotated-public-token` },
					})
				).status,
			).toBe(401);
		} finally {
			await transport.terminateSession().catch(() => undefined);
			await client.close().catch(() => undefined);
			await expect(requestAttachedEditor('token.request', {})).rejects.toThrow(/editor/i);
			await hub.close();
			await server.close().catch(() => undefined);
		}
	});
});

it('forwards tool catalog changes through the HTTP-to-stdio proxy', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-proxy-'));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const port = await freePort();
	const hub = await startSharedHttpServer({ port, discoveryDir: dir, createEditorServer: createMcpServer });
	cleanups.push(() => hub.close());
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let output = '';
	stdout.on('data', chunk => {
		output += chunk.toString();
	});
	const running = runStdioProxy({ port, publicToken: hub.descriptor.publicToken, stdin, stdout });
	cleanups.push(async () => {
		stdin.end();
		await running;
	});
	const send = (message: object) => stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
	send({
		id: 1,
		method: 'initialize',
		params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
	});
	await vi.waitFor(() => expect(output).toContain('"id":1'));
	expect(JSON.parse(output.trim()).result.capabilities.tools.listChanged).toBe(true);
	send({ method: 'notifications/initialized' });
	send({ id: 2, method: 'tools/list' });
	await vi.waitFor(() => expect(output).toContain('"id":2'));
	output = '';
	const unregister = registerHostCapabilities([
		{
			spec: { name: 'buddy_proxy_dynamic', description: 'proxy test', inputSchema: { type: 'object' } },
			access: 'read',
			async run() {
				return 'ok';
			},
		},
	]);
	try {
		await vi.waitFor(() => expect(output).toContain('notifications/tools/list_changed'));
		output = '';
		unregister();
		await vi.waitFor(() => expect(output).toContain('notifications/tools/list_changed'));
	} finally {
		unregister();
	}
});
