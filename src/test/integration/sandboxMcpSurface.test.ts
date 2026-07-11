import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WorkingScopeManager } from '@models';
import { SessionManager, type Session } from '@sessions';
import { clearCachedSession, getTestOrgId, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import * as assert from 'assert';
import { randomUUID } from 'crypto';
import * as Mocha from 'mocha';
import { _resetMcpThrottleForTesting } from '../../mcp/McpActions';
import { buildMcpServer } from '../../mcp/mcpServer';
import { rawGraphqlOrThrow } from '../../capabilities/inputHelpers';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

function resultText(result: unknown): string {
	const content = (result as { content?: unknown } | undefined)?.content;
	return ((content ?? []) as { type?: string; text?: string }[])
		.filter(part => part.type === 'text')
		.map(part => part.text ?? '')
		.join('');
}

const SANDBOX_MCP_ANCHORS = `query RbItestSandboxMcpAnchors($orgId: ID!) {
  workflows(where: { orgId: $orgId }, limit: 1) { id orgId }
  templates(where: { orgId: $orgId }, limit: 1) { id orgId }
}`;

suite('Integration: sandbox MCP surface', function () {
	this.timeout(120_000);

	let session: Session;
	let orgId: string;
	let workflowId: string | undefined;
	let templateId: string | undefined;
	let server: ReturnType<typeof buildMcpServer>;
	let client: Client;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		orgId = getTestOrgId();
		session = await getTestSession();
		if (session.profile.org.id !== orgId || session.profile.allManagedOrgs.length !== 1) {
			throw new Error('Safety invariant failed: MCP integration session is not sandbox-only.');
		}
		SessionManager._setSessionsForTesting([session]);
		WorkingScopeManager._resetForTesting();
		WorkingScopeManager.setOrgs([orgId]);

		const anchors = (await rawGraphqlOrThrow(session, SANDBOX_MCP_ANCHORS, { orgId })) as {
			workflows?: { id: string; orgId: string }[];
			templates?: { id: string; orgId: string }[];
		};
		workflowId = anchors.workflows?.[0]?.id;
		templateId = anchors.templates?.[0]?.id;
		assert.ok((anchors.workflows ?? []).every(row => row.orgId === orgId));
		assert.ok((anchors.templates ?? []).every(row => row.orgId === orgId));

		server = buildMcpServer();
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		client = new Client({ name: 'rewst-buddy-sandbox-itest', version: '1' });
		await client.connect(clientTransport);
	});

	setup(() => {
		_resetMcpThrottleForTesting();
	});

	suiteTeardown(async () => {
		await client?.close();
		await server?.close();
		WorkingScopeManager._resetForTesting();
		SessionManager._resetForTesting();
		clearCachedSession();
	});

	test('advertises the read surface while keeping write and dangerous tools hidden', async () => {
		const response = await client.listTools();
		const names = response.tools.map(tool => tool.name);
		for (const expected of [
			'buddy_list_workflows',
			'buddy_search_templates',
			'buddy_get_workflow',
			'buddy_get_template',
			'buddy_list_triggers',
		]) {
			assert.ok(names.includes(expected), expected);
		}
		for (const hidden of ['buddy_create_workflow', 'buddy_create_template', 'buddy_graphql_mutate']) {
			assert.ok(!names.includes(hidden), hidden);
		}
	});

	test('buddy_list_orgs returns only the sandbox-scoped session org over MCP', async () => {
		const result = await client.callTool({ name: 'buddy_list_orgs', arguments: {} });
		assert.notStrictEqual(result.isError, true, resultText(result));
		assert.ok(resultText(result).includes(orgId));
		assert.strictEqual(resultText(result).split('\n').filter(Boolean).length, 1, resultText(result));
	});

	test('buddy_list_workflows traverses the live sandbox through the MCP adapter', async () => {
		const result = await client.callTool({ name: 'buddy_list_workflows', arguments: { orgId, limit: 3 } });
		assert.notStrictEqual(result.isError, true, resultText(result));
		assert.ok(resultText(result).length > 0);
		if (workflowId) assert.ok(resultText(result).includes(workflowId), resultText(result));
	});

	test('buddy_search_templates traverses the live sandbox through the MCP adapter', async () => {
		const result = await client.callTool({ name: 'buddy_search_templates', arguments: { orgId, limit: 3 } });
		assert.notStrictEqual(result.isError, true, resultText(result));
		assert.ok(resultText(result).length > 0);
		if (templateId) assert.ok(resultText(result).includes(templateId), resultText(result));
	});

	test('MCP advertises exactly the sandbox template and workflow collections', async () => {
		const response = await client.listResources();
		assert.deepStrictEqual(
			response.resources.map(resource => resource.uri).sort(),
			[`rewst://${orgId}/templates`, `rewst://${orgId}/workflows`].sort(),
		);
	});

	test('reads the sandbox workflow collection as an MCP resource', async () => {
		const uri = `rewst://${orgId}/workflows`;
		const response = await client.readResource({ uri });
		const text = response.contents.map(content => ('text' in content ? content.text : '')).join('');
		assert.ok(text.length > 0);
		if (workflowId) assert.ok(text.includes(workflowId), text);
	});

	test('reads a discovered sandbox template as an MCP item resource', async function () {
		if (!templateId) {
			this.skip();
			return;
		}
		const uri = `rewst://${orgId}/templates/${templateId}`;
		const response = await client.readResource({ uri });
		const text = response.contents.map(content => ('text' in content ? content.text : '')).join('');
		const template = JSON.parse(text);
		assert.strictEqual(template.id, templateId);
		assert.strictEqual(template.orgId, orgId);
	});

	test('rejects an out-of-scope org before the MCP adapter can resolve a live session', async () => {
		const outside = randomUUID();
		const result = await client.callTool({
			name: 'buddy_list_workflows',
			arguments: { orgId: outside, limit: 1 },
		});
		assert.strictEqual(result.isError, true);
		assert.match(resultText(result), /outside the working scope|not in the working scope/i);
	});

	test('rejects write calls at the MCP boundary without creating sandbox data', async () => {
		const result = await client.callTool({
			name: 'buddy_create_template',
			arguments: { orgId, name: `[RB ITEST SHOULD NOT CREATE] ${randomUUID()}`, body: '' },
		});
		assert.strictEqual(result.isError, true);
		assert.match(resultText(result), /not available|write tools are disabled|unknown tool/i);
	});
});
