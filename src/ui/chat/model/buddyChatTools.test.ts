import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import { _resetMcpThrottleForTesting, type McpToolDescriptor } from '@mcp';
import { SessionManager } from '@sessions';
import { buddyChatToolSpecs, runBuddyChatTool, toolSpecsFromDescriptors } from './buddyChatTools';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: buddyChatTools', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		_resetMcpThrottleForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
	});

	suite('toolSpecsFromDescriptors()', () => {
		test('maps an MCP descriptor into a chat tool spec with a JSON arg signature', () => {
			const descriptor: McpToolDescriptor = {
				name: 'buddy_workflow_get',
				description: 'Fetch a workflow',
				inputSchema: { type: 'object', properties: { workflowId: { type: 'string' } } },
			};
			const [spec] = toolSpecsFromDescriptors([descriptor]);
			assert.strictEqual(spec.name, 'buddy_workflow_get');
			assert.strictEqual(spec.description, 'Fetch a workflow');
			assert.strictEqual(spec.args, JSON.stringify(descriptor.inputSchema));
			assert.deepStrictEqual(spec.inputSchema, descriptor.inputSchema);
		});
	});

	suite('buddyChatToolSpecs()', () => {
		test('advertises nothing while the MCP server is disabled (the default)', () => {
			// rewst-buddy.mcp.enable defaults to false, so an opted-out user gets no
			// buddy tools injected into Cage-Free Rewsty.
			assert.deepStrictEqual(buddyChatToolSpecs(), []);
		});

		test('advertises the MCP-exposed read tools once the server is enabled', async () => {
			const config = vscode.workspace.getConfiguration('rewst-buddy.mcp');
			await config.update('enable', true, vscode.ConfigurationTarget.Global);
			try {
				const names = buddyChatToolSpecs().map(spec => spec.name);
				assert.ok(names.length > 0, 'enabling the server advertises the exposed tools');
				assert.ok(names.includes('list_orgs'), 'a known read tool is advertised');
			} finally {
				await config.update('enable', undefined, vscode.ConfigurationTarget.Global);
			}
		});
	});

	suite('runBuddyChatTool()', () => {
		test('captures a thrown McpError as an error result instead of aborting the turn', async () => {
			// callTool throws McpError('unknown_tool') for an unrecognized name, before
			// any session/throttle work — exercises the real catch path end to end.
			const result = await runBuddyChatTool('definitely_not_a_buddy_tool', {}, 'org-x');
			assert.strictEqual(result.isError, true);
			assert.ok(result.text.includes('definitely_not_a_buddy_tool'), 'the error text names the tool');
		});

		test('returns a successful result from a tool that runs in-process', async () => {
			// list_orgs reads from the session profile (no API), so it succeeds purely
			// in-process and exercises the normal { text, isError: false } return path.
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });
			const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
			SessionManager._setSessionsForTesting([session]);

			const result = await runBuddyChatTool('list_orgs', {}, 'org-1');

			assert.strictEqual(result.isError, false);
			assert.ok(result.text.includes('Test Org'), 'the tool output is returned as text');
		});
	});
});
