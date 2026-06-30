import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { RESULT_READ_TOOL_NAME } from '@capabilities';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import { _resetMcpThrottleForTesting, type McpToolDescriptor } from '@mcp';
import { SessionManager } from '@sessions';
import { buddyChatToolSpecs, runBuddyChatTool, toolSpecsFromDescriptors } from './buddyChatTools';
import { WORKFLOW_EDIT_TOOL_NAME } from '../tools/workflowTools';

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
		test('advertises read Buddy tools even while the external MCP server is disabled', () => {
			// rewst-buddy.mcp.enable controls external /mcp access only. Cage-Free Rewsty
			// still needs in-process Buddy tools so server-side Rewst tools are redirected
			// to the local approval/scope path.
			const names = buddyChatToolSpecs().map(spec => spec.name);
			assert.ok(names.length > 0, 'read tools are advertised by default');
			assert.ok(names.includes('buddy_list_orgs'), 'a known read tool is advertised');
			assert.ok(names.includes(RESULT_READ_TOOL_NAME), 'result paging is advertised to Cage-Free Rewsty');
			assert.ok(!names.includes(WORKFLOW_EDIT_TOOL_NAME), 'write tools stay hidden by default');
		});

		test('honors the write-tool toggle without requiring the external MCP server', async () => {
			const config = vscode.workspace.getConfiguration('rewst-buddy.mcp');
			await config.update('enableWriteTools', true, vscode.ConfigurationTarget.Global);
			try {
				const names = buddyChatToolSpecs().map(spec => spec.name);
				assert.ok(names.includes(WORKFLOW_EDIT_TOOL_NAME), 'write tools follow enableWriteTools');
			} finally {
				await config.update('enableWriteTools', undefined, vscode.ConfigurationTarget.Global);
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
			// buddy_list_orgs reads from the session profile (no API), so it succeeds purely
			// in-process and exercises the normal { text, isError: false } return path.
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });
			const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
			SessionManager._setSessionsForTesting([session]);

			const result = await runBuddyChatTool('buddy_list_orgs', {}, 'org-1');

			assert.strictEqual(result.isError, false);
			assert.ok(result.text.includes('Test Org'), 'the tool output is returned as text');
		});
	});
});
