import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/mcpServer';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { configureRuntimeHost } from '../src/host';
import { MemoryStateStore, MemorySecretStore } from '../src/storage';
import { createSharedEditorServer, requestAttachedEditor, handleSharedBrowserAction } from '../src/editorBridge';
import {
	getCapability,
	registerHostCapabilities,
	runCapability,
	runWithHostCapabilityRunner,
} from '../src/capabilities/registry';
import type { Capability } from '../src/capabilities/Capability';
import { callTool } from '../src/mcp/McpActions';
import { WorkingScopeManager } from '../src/models/WorkingScopeManager';
import { SessionManager } from '../src/sessions';
const closing: (() => Promise<void>)[] = [];
beforeEach(() => {
	configureRuntimeHost({
		state: new MemoryStateStore(),
		secrets: new MemorySecretStore(),
		getSetting: (_k, f) => f,
		log() {},
	});
	WorkingScopeManager._resetForTesting();
});
afterEach(async () => {
	for (const close of closing.splice(0)) await close();
});
async function editor() {
	const client = new Client({ name: 'editor-test', version: '1' });
	client.setRequestHandler(
		z.object({
			method: z.literal('rewst/editor'),
			params: z.object({ operation: z.string(), input: z.record(z.string(), z.unknown()) }),
		}),
		async request => ({
			result:
				request.params.operation === 'browser.openTemplate'
					? { success: true }
					: request.params.operation === 'capability.run'
						? JSON.stringify(request.params.input)
						: request.params.input,
		}),
	);
	const server = createSharedEditorServer();
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(b);
	await client.connect(a);
	closing.push(async () => {
		await client.close();
		await server.close();
	});
	return client;
}
test('only an attached editor receives UI requests and disconnect removes it', async () => {
	const client = await editor();
	await expect(requestAttachedEditor('token.request', {})).rejects.toThrow(/editor/i);
	const result = await client.callTool({
		name: 'rewst_editor_operation',
		arguments: { operation: 'editor.attach', input: { capabilities: [] } },
	});
	expect(result.isError).not.toBe(true);
	expect(await requestAttachedEditor('approval.scope', { hello: 'world' })).toEqual({ hello: 'world' });
	await client.close();
	await expect(requestAttachedEditor('token.request', {})).rejects.toThrow(/editor/i);
});

test('attach returns the owner session snapshot without copying credentials', async () => {
	const session = {
		profile: {
			user: { id: 'owner-user', username: 'owner@example.test' },
			org: { id: 'owner-org', name: 'Owner Org' },
			allManagedOrgs: [],
		},
		isExpired: () => false,
		onExpired: () => ({ dispose() {} }),
	};
	SessionManager._setSessionsForTesting([session as never]);
	const client = await editor();
	try {
		const result = await client.callTool({
			name: 'rewst_editor_operation',
			arguments: { operation: 'editor.attach', input: { capabilities: [] } },
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			result: {
				attached: true,
				sessions: {
					sessions: [{ sessionId: 'owner-user', expired: false }],
					knownProfiles: [{ user: { id: 'owner-user' } }],
				},
			},
		});
		expect(JSON.stringify(result)).not.toMatch(/cookie|token|secret/i);
	} finally {
		await client.close();
		SessionManager._resetForTesting();
	}
});
test('browser open-template delegates to the attached editor', async () => {
	await expect(
		handleSharedBrowserAction({ action: 'openTemplate', orgId: 'org', templateId: 'template' }),
	).rejects.toThrow(/editor/i);
	const client = await editor();
	await client.callTool({
		name: 'rewst_editor_operation',
		arguments: { operation: 'editor.attach', input: { capabilities: [] } },
	});
	expect(await handleSharedBrowserAction({ action: 'openTemplate', orgId: 'org', templateId: 'template' })).toEqual({
		success: true,
	});
});
test('a remote editor cannot replace a built-in capability', async () => {
	const original = getCapability('buddy_list_orgs');
	const client = await editor();
	const result = await client.callTool({
		name: 'rewst_editor_operation',
		arguments: {
			operation: 'editor.attach',
			input: {
				capabilities: [
					{
						spec: { name: 'buddy_list_orgs', description: 'overwrite', inputSchema: { type: 'object' } },
						access: 'read',
					},
				],
			},
		},
	});
	expect(result.isError).toBe(true);
	expect(getCapability('buddy_list_orgs')).toBe(original);
});

test('each shared editor routes host capabilities to its own attached client', async () => {
	const hostCapability: Capability = {
		spec: { name: 'buddy_test_host_route', description: 'test host route', inputSchema: { type: 'object' } },
		access: 'read',
		requiresOrg: false,
		async run() {
			return 'owner implementation';
		},
	};
	const unregister = registerHostCapabilities([hostCapability]);
	SessionManager._setSessionsForTesting([
		{
			profile: { user: { id: 'user-1' }, org: { id: 'org-1', name: 'Org' }, allManagedOrgs: [] },
			isExpired: () => false,
			onExpired: () => ({ dispose() {} }),
		} as never,
	]);
	const servers: Server[] = [];
	const clients: Client[] = [];
	try {
		for (const label of ['editor-a', 'editor-b']) {
			const client = new Client({ name: label, version: '1' });
			client.setRequestHandler(
				z.object({
					method: z.literal('rewst/editor'),
					params: z.object({ operation: z.string(), input: z.record(z.string(), z.unknown()) }),
				}),
				async request => ({
					result: JSON.stringify({
						from: label,
						operation: request.params.operation,
						input: request.params.input,
					}),
				}),
			);
			const server = createSharedEditorServer();
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			const attached = await client.callTool({
				name: 'rewst_editor_operation',
				arguments: {
					operation: 'editor.attach',
					input: {
						capabilities: [
							{ spec: hostCapability.spec, access: hostCapability.access, requiresOrg: false },
						],
					},
				},
			});
			expect(attached.isError).not.toBe(true);
			clients.push(client);
			servers.push(server);
		}
		const args = { name: hostCapability.spec.name, arguments: { origin: 'mcp' }, origin: 'mcp' as const };
		const first = await clients[0].callTool({
			name: 'rewst_editor_operation',
			arguments: { operation: 'tools.call', input: args },
		});
		const second = await clients[1].callTool({
			name: 'rewst_editor_operation',
			arguments: { operation: 'tools.call', input: args },
		});
		const firstToolResult = JSON.parse(String((first.content[0] as { text?: string }).text)) as { text: string };
		const secondToolResult = JSON.parse(String((second.content[0] as { text?: string }).text)) as { text: string };
		expect(JSON.parse(firstToolResult.text)).toMatchObject({ from: 'editor-a', input: { origin: 'chat' } });
		expect(JSON.parse(secondToolResult.text)).toMatchObject({ from: 'editor-b', input: { origin: 'chat' } });
		const direct = await callTool(args);
		expect(direct.text).toBe('owner implementation');
	} finally {
		unregister();
		for (const client of clients) await client.close().catch(() => undefined);
		for (const server of servers) await server.close().catch(() => undefined);
	}
});

test('a same-metadata built-in capability is never treated as host-routable', async () => {
	const capability = getCapability('buddy_list_orgs');
	expect(capability).toBeTruthy();
	let routed = false;
	const result = await runWithHostCapabilityRunner(
		async () => {
			routed = true;
			return 'wrong-window';
		},
		() => runCapability(capability!, {}, { session: {} as never, orgId: '', sessions: [] }),
	);
	expect(routed).toBe(false);
	expect(result).not.toBe('wrong-window');
});

test('public clients refresh their catalog when editors attach, replace tools, and disconnect', async () => {
	const publicServer = createMcpServer();
	const client = new Client({ name: 'public-test', version: '1' });
	const changed = vi.fn();
	client.setNotificationHandler(ToolListChangedNotificationSchema, changed);
	const [a, b] = InMemoryTransport.createLinkedPair();
	await publicServer.connect(b);
	await client.connect(a);
	closing.push(
		() => client.close(),
		() => publicServer.close(),
	);
	expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true);
	const name = 'buddy_test_dynamic_editor';
	const names = async () => (await client.listTools()).tools.map(tool => tool.name);
	expect(await names()).not.toContain(name);
	const first = await editor();
	const second = await editor();
	const attach = async (editorClient: Client, include: boolean) => {
		const result = await editorClient.callTool({
			name: 'rewst_editor_operation',
			arguments: {
				operation: 'editor.attach',
				input: {
					capabilities: include
						? [
								{
									spec: { name, description: 'dynamic editor test', inputSchema: { type: 'object' } },
									access: 'read',
									requiresOrg: false,
								},
							]
						: [],
				},
			},
		});
		expect(result.isError).not.toBe(true);
	};
	await attach(first, true);
	await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
	expect(await names()).toContain(name);
	await attach(second, true);
	await attach(first, false);
	expect(await names()).toContain(name);
	expect(changed).toHaveBeenCalledTimes(1);
	await attach(second, false);
	await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
	expect(await names()).not.toContain(name);
	await attach(first, true);
	await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
	await first.close();
	await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(4));
	expect(await names()).not.toContain(name);
});

test.each(['buddy_template_sync', 'buddy_template_sync_status'])(
	'%s is only callable while a supporting VS Code editor is attached',
	async name => {
		configureRuntimeHost({
			state: new MemoryStateStore(),
			secrets: new MemorySecretStore(),
			getSetting: (key, fallback) => (key === 'mcp.enableWriteTools' ? true : fallback) as typeof fallback,
			log() {},
		});
		WorkingScopeManager.applyChange({ orgs: ['org'] });
		const validate = vi.fn(async () => true);
		const session = {
			profile: { user: { id: 'user' }, org: { id: 'org', name: 'Org' }, allManagedOrgs: [] },
			validate,
			isExpired: () => false,
			onExpired: () => ({ dispose() {} }),
		};
		const sessions = vi.spyOn(SessionManager, 'getActiveSessions').mockReturnValue([session as never]);
		const resolve = vi.spyOn(SessionManager, 'getSessionForOrg').mockResolvedValue(session as never);
		const publicServer = createMcpServer();
		const client = new Client({ name: 'sync-client', version: '1' });
		const changed = vi.fn();
		client.setNotificationHandler(ToolListChangedNotificationSchema, changed);
		const [a, b] = InMemoryTransport.createLinkedPair();
		await publicServer.connect(b);
		await client.connect(a);
		closing.push(
			() => client.close(),
			() => publicServer.close(),
		);
		const names = async () => (await client.listTools()).tools.map(tool => tool.name);
		const request = {
			name,
			arguments: { orgId: 'org', uri: '/linked.jinja', direction: 'upload', origin: 'chat' },
		};
		const expectUnavailable = async () => {
			expect(await names()).not.toContain(name);
			const result = await client.callTool(request);
			expect(result.isError).toBe(true);
			expect(result.structuredContent).toMatchObject({ code: 'unknown_tool' });
		};
		try {
			await expectUnavailable();
			const vscode = await editor();
			// A transport connection alone does not advertise editor functionality.
			await expectUnavailable();
			const attached = await vscode.callTool({
				name: 'rewst_editor_operation',
				arguments: {
					operation: 'editor.attach',
					input: {
						capabilities: [
							{
								spec: { name, description: 'Editor template sync', inputSchema: { type: 'object' } },
								access: name === 'buddy_template_sync' ? 'write' : 'read',
							},
						],
					},
				},
			});
			expect(attached.isError).not.toBe(true);
			await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
			expect(await names()).toContain(name);
			const response = await client.callTool(request);
			expect(response.isError).not.toBe(true);
			expect(response.structuredContent).toMatchObject({ result: { origin: 'mcp', args: { origin: 'chat' } } });

			// The capability has already been resolved when the editor disconnects.
			let finishValidation!: (valid: boolean) => void;
			validate.mockImplementationOnce(
				() =>
					new Promise<boolean>(resolve => {
						finishValidation = resolve;
					}),
			);
			const pending = client.callTool(request);
			await vi.waitFor(() => expect(finishValidation).toBeDefined());
			await vscode.close();
			await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
			finishValidation(true);
			const interrupted = await pending;
			expect(interrupted.isError).toBe(true);
			expect(interrupted.content).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: 'text', text: expect.stringMatching(/No editor is attached/) }),
				]),
			);
			await expectUnavailable();
		} finally {
			sessions.mockRestore();
			resolve.mockRestore();
		}
	},
);
