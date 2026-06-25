import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { McpToolDescriptor } from '@mcp';
import { buddyChatToolSpecs, runBuddyChatTool, toolSpecsFromDescriptors } from './buddyChatTools';

const { suite, test, setup } = Mocha;

suite('Unit: buddyChatTools', () => {
	setup(() => {
		initTestEnvironment();
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
	});

	suite('runBuddyChatTool()', () => {
		test('captures a thrown McpError as an error result instead of aborting the turn', async () => {
			// callTool throws McpError('unknown_tool') for an unrecognized name, before
			// any session/throttle work — exercises the real catch path end to end.
			const result = await runBuddyChatTool('definitely_not_a_buddy_tool', {}, 'org-x');
			assert.strictEqual(result.isError, true);
			assert.ok(result.text.includes('definitely_not_a_buddy_tool'), 'the error text names the tool');
		});
	});
});
