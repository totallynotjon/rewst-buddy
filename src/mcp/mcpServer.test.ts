import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SessionManager } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { _resetMcpThrottleForTesting } from './McpActions';
import { buildMcpServer, handleMcpHttp } from './mcpServer';
import { mcpAuthorizationHeader } from './protocol';
import { _resetMcpTokenForTesting, getMcpToken, rotateMcpToken } from './runtime';

const { suite, test, setup, teardown } = Mocha;

function useSession(orgId = 'org-1', orgName = 'Acme') {
	const { session } = createMockSession({ profile: { org: { id: orgId, name: orgName } } });
	SessionManager._setSessionsForTesting([session]);
}

/** Minimal ServerResponse stand-in capturing the early-return gate writes. */
function fakeRes() {
	return {
		statusCode: 0,
		body: '',
		headersSent: false,
		writeHead(status: number) {
			this.statusCode = status;
			return this;
		},
		end(body?: string) {
			if (typeof body === 'string') this.body = body;
		},
		on() {
			return this;
		},
	};
}

suite('Unit: mcpServer', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		_resetMcpThrottleForTesting();
	});

	teardown(async () => {
		SessionManager._resetForTesting();
		// The token persists in globalState (and an in-memory cache); clear both so
		// it cannot leak into other suites.
		await _resetMcpTokenForTesting();
		await vscode.workspace
			.getConfiguration('rewst-buddy.mcp')
			.update('enable', undefined, vscode.ConfigurationTarget.Global);
	});

	suite('MCP SDK server (in-memory transport)', () => {
		test('lists read tools and runs buddy_list_orgs end to end', async () => {
			useSession('org-1', 'Acme');
			const server = buildMcpServer();
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			const client = new Client({ name: 'test-client', version: '0' });
			await client.connect(clientTransport);

			try {
				const tools = await client.listTools();
				assert.ok(tools.tools.some(tool => tool.name === 'buddy_list_orgs'));
				assert.ok(!tools.tools.some(tool => tool.name === 'buddy_graphql'), 'chat write tool not exposed');

				const result = await client.callTool({ name: 'buddy_list_orgs', arguments: {} });
				const text = (result.content as { type: string; text: string }[]).map(part => part.text).join('');
				assert.ok(text.includes('Acme (org-1)'));
				assert.notStrictEqual(result.isError, true);
			} finally {
				await client.close();
				await server.close();
			}
		});

		test('a gate failure comes back as an isError tool result', async () => {
			useSession('org-1');
			const server = buildMcpServer();
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			const client = new Client({ name: 'test-client', version: '0' });
			await client.connect(clientTransport);

			try {
				const result = await client.callTool({ name: 'buddy_list_templates', arguments: {} });
				assert.strictEqual(result.isError, true);
				const text = (result.content as { type: string; text: string }[]).map(part => part.text).join('');
				assert.ok(/orgId/i.test(text), 'explains the missing orgId');
			} finally {
				await client.close();
				await server.close();
			}
		});
	});

	suite('handleMcpHttp() gate', () => {
		test('returns 403 when mcp.enable is off (default)', async () => {
			const res = fakeRes();
			await handleMcpHttp({ headers: {} } as never, res as never);
			assert.strictEqual(res.statusCode, 403);
			assert.ok(res.body.includes('mcp_disabled'));
		});

		test('returns 401 for a missing/invalid token when enabled', async () => {
			await vscode.workspace
				.getConfiguration('rewst-buddy.mcp')
				.update('enable', true, vscode.ConfigurationTarget.Global);
			rotateMcpToken();
			const res = fakeRes();
			await handleMcpHttp({ headers: { authorization: mcpAuthorizationHeader('wrong') } } as never, res as never);
			assert.strictEqual(res.statusCode, 401);
			assert.ok(res.body.includes('bad_token'));
		});

		test('returns 401 when the token is sent without the Bearer scheme', async () => {
			await vscode.workspace
				.getConfiguration('rewst-buddy.mcp')
				.update('enable', true, vscode.ConfigurationTarget.Global);
			const token = getMcpToken();
			const res = fakeRes();
			// A bare token (no "Bearer " prefix) must not authenticate.
			await handleMcpHttp({ headers: { authorization: token } } as never, res as never);
			assert.strictEqual(res.statusCode, 401);
			assert.ok(res.body.includes('bad_token'));
		});
	});

	suite('MCP SDK server — instructions and prompts', () => {
		test('client.getInstructions() is non-empty and contains buddy_workflow_get', async () => {
			useSession('org-1', 'Acme');
			const server = buildMcpServer();
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			const client = new Client({ name: 'test-client', version: '0' });
			await client.connect(clientTransport);

			try {
				const instructions = client.getInstructions();
				assert.ok(
					typeof instructions === 'string' && instructions.length > 0,
					'instructions must be non-empty',
				);
				assert.ok(
					instructions.includes('buddy_workflow_get'),
					'instructions must reference buddy_workflow_get',
				);
			} finally {
				await client.close();
				await server.close();
			}
		});

		test('client.listPrompts() returns the three recipe prompts', async () => {
			useSession('org-1', 'Acme');
			const server = buildMcpServer();
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			const client = new Client({ name: 'test-client', version: '0' });
			await client.connect(clientTransport);

			try {
				const result = await client.listPrompts();
				const names = result.prompts.map((p: { name: string }) => p.name);
				assert.ok(names.includes('debug-execution'), 'must include debug-execution');
				assert.ok(names.includes('safe-workflow-edit'), 'must include safe-workflow-edit');
				assert.ok(names.includes('compose-sub-workflow'), 'must include compose-sub-workflow');
			} finally {
				await client.close();
				await server.close();
			}
		});

		test('getPrompt debug-execution with executionId returns user message containing the id', async () => {
			useSession('org-1', 'Acme');
			const server = buildMcpServer();
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			const client = new Client({ name: 'test-client', version: '0' });
			await client.connect(clientTransport);

			try {
				const result = await client.getPrompt({
					name: 'debug-execution',
					arguments: { executionId: 'abc-123' },
				});
				assert.strictEqual(result.messages.length, 1);
				const msg = result.messages[0];
				assert.strictEqual(msg.role, 'user');
				const text = (msg.content as { type: string; text: string }).text;
				assert.ok(text.includes('abc-123'), 'rendered prompt must include the executionId');
			} finally {
				await client.close();
				await server.close();
			}
		});

		test('getPrompt with unknown name throws an error', async () => {
			useSession('org-1', 'Acme');
			const server = buildMcpServer();
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			const client = new Client({ name: 'test-client', version: '0' });
			await client.connect(clientTransport);

			try {
				await assert.rejects(
					() => client.getPrompt({ name: 'no-such-prompt', arguments: {} }),
					(err: unknown) => err instanceof Error && /unknown prompt/i.test(err.message),
				);
			} finally {
				await client.close();
				await server.close();
			}
		});
	});

	suite('token', () => {
		test('is stable across reads and validates only itself', () => {
			const token = getMcpToken();
			assert.strictEqual(getMcpToken(), token, 'token is stable');
			const rotated = rotateMcpToken();
			assert.notStrictEqual(rotated, token, 'rotation changes the token');
			assert.strictEqual(getMcpToken(), rotated);
		});
	});
});
