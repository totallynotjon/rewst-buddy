import * as assert from 'assert';
import * as Mocha from 'mocha';
import {
	BridgeError,
	handleCallTool,
	handleListResources,
	handleListTools,
	handleReadResource,
	type ExtensionCall,
} from './bridge';
import { MCP_PROTOCOL_VERSION, type McpRequest, type McpResponse } from './protocol';

const { suite, test } = Mocha;

/** A stub extension call that records requests and returns a canned response. */
function stub(response: McpResponse): { call: ExtensionCall; requests: McpRequest[] } {
	const requests: McpRequest[] = [];
	const call: ExtensionCall = async request => {
		requests.push(request);
		return response;
	};
	return { call, requests };
}

function okBody(result: unknown): McpResponse {
	return { ok: true, protocolVersion: MCP_PROTOCOL_VERSION, result };
}

suite('Unit: MCP bridge mapping', () => {
	suite('handleListTools', () => {
		test('forwards mcp.listTools and returns the tool list', async () => {
			const { call, requests } = stub(okBody({ tools: [{ name: 'list_orgs' }] }));
			const result = await handleListTools(call);
			assert.deepStrictEqual(requests, [{ action: 'mcp.listTools' }]);
			assert.deepStrictEqual(result.tools, [{ name: 'list_orgs' }]);
		});

		test('throws BridgeError on a transport error response', async () => {
			const { call } = stub({
				ok: false,
				protocolVersion: MCP_PROTOCOL_VERSION,
				error: { code: 'mcp_disabled', message: 'disabled' },
			});
			await assert.rejects(handleListTools(call), (error: unknown) => error instanceof BridgeError);
		});
	});

	suite('handleCallTool', () => {
		test('passes name + arguments through and maps a text result', async () => {
			const { call, requests } = stub(okBody({ text: 'Acme (org-1)' }));
			const result = await handleCallTool(call, { name: 'list_templates', arguments: { orgId: 'org-1' } });
			assert.deepStrictEqual(requests, [
				{ action: 'mcp.callTool', name: 'list_templates', arguments: { orgId: 'org-1' } },
			]);
			assert.deepStrictEqual(result, { content: [{ type: 'text', text: 'Acme (org-1)' }], isError: false });
		});

		test('marks a tool-level isError result', async () => {
			const { call } = stub(okBody({ text: 'not found', isError: true }));
			const result = await handleCallTool(call, { name: 'get_template' });
			assert.strictEqual(result.isError, true);
			assert.strictEqual(result.content[0].text, 'not found');
		});

		test('turns a transport error into an isError result rather than throwing', async () => {
			const { call } = stub({
				ok: false,
				protocolVersion: MCP_PROTOCOL_VERSION,
				error: { code: 'org_not_found', message: 'No active session manages org' },
			});
			const result = await handleCallTool(call, { name: 'list_templates', arguments: { orgId: 'x' } });
			assert.strictEqual(result.isError, true);
			assert.ok(result.content[0].text.includes('No active session'));
		});

		test('defaults missing arguments to an empty object', async () => {
			const { call, requests } = stub(okBody({ text: 'ok' }));
			await handleCallTool(call, { name: 'list_orgs' });
			assert.deepStrictEqual((requests[0] as { arguments: unknown }).arguments, {});
		});
	});

	suite('handleListResources / handleReadResource', () => {
		test('forwards mcp.listResources', async () => {
			const { call, requests } = stub(okBody({ resources: [{ uri: 'rewst://org-1/templates' }] }));
			const result = await handleListResources(call);
			assert.strictEqual((requests[0] as { action: string }).action, 'mcp.listResources');
			assert.strictEqual(result.resources.length, 1);
		});

		test('maps a read resource into MCP contents', async () => {
			const { call, requests } = stub(
				okBody({ uri: 'rewst://org-1/templates', mimeType: 'text/plain', text: 'body' }),
			);
			const result = await handleReadResource(call, { uri: 'rewst://org-1/templates' });
			assert.deepStrictEqual(requests, [{ action: 'mcp.readResource', uri: 'rewst://org-1/templates' }]);
			assert.deepStrictEqual(result.contents, [
				{ uri: 'rewst://org-1/templates', mimeType: 'text/plain', text: 'body' },
			]);
		});
	});
});
