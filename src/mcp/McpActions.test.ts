import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import { McpError, _resetMcpThrottleForTesting, callTool, handleMcpRequest, listTools } from './McpActions';
import { MCP_PROTOCOL_VERSION } from './protocol';
import { rotateMcpToken } from './runtime';
import type { McpSettings } from './settings';

const { suite, test, setup, teardown } = Mocha;

function settings(over: Partial<McpSettings> = {}): McpSettings {
	return { enable: true, enableWriteTools: false, enabledTools: [], ...over };
}

/** A mock session managing one org, registered with the SessionManager. */
function useSession(orgId = 'org-1', orgName = 'Acme') {
	const { session, wrapper } = createMockSession({ profile: { org: { id: orgId, name: orgName } } });
	SessionManager._setSessionsForTesting([session]);
	return { session, wrapper };
}

async function okResult(promise: Promise<{ ok: boolean }>): Promise<{ text: string; isError?: boolean }> {
	const response = await promise;
	assert.ok(response.ok, 'expected ok response');
	return (response as unknown as { result: { text: string; isError?: boolean } }).result;
}

suite('Unit: McpActions', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		_resetMcpThrottleForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
	});

	suite('listTools()', () => {
		test('exposes the read tools and hides the GraphQL chat/write tools', () => {
			const names = listTools(settings()).map(tool => tool.name);
			assert.ok(names.includes('list_orgs'));
			assert.ok(names.includes('list_templates'));
			assert.ok(names.includes('get_template'));
			assert.ok(names.includes('list_workflows'));
			assert.ok(names.includes('get_workflow'));
			assert.ok(!names.includes('rewst_graphql'), 'chat write tool is not on MCP');
			assert.ok(!names.includes('rewst_graphql_schema'), 'chat schema tool is not on MCP');
		});

		test('an allowlist restricts the exposed tools', () => {
			const names = listTools(settings({ enabledTools: ['list_orgs'] })).map(tool => tool.name);
			assert.deepStrictEqual(names, ['list_orgs']);
		});
	});

	suite('callTool()', () => {
		test('list_orgs enumerates orgs across active sessions without an orgId', async () => {
			useSession('org-1', 'Acme');
			const result = await okResult(callTool({ action: 'mcp.callTool', name: 'list_orgs' }, settings()));
			assert.ok(result.text.includes('Acme (org-1)'));
			assert.ok(!result.isError);
		});

		test('list_templates returns template names for the org', async () => {
			const { wrapper } = useSession('org-1');
			wrapper.when('listTemplates', {
				data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't-1', name: 'Welcome' })]),
			});
			const result = await okResult(
				callTool({ action: 'mcp.callTool', name: 'list_templates', arguments: { orgId: 'org-1' } }, settings()),
			);
			assert.ok(result.text.includes('Welcome (t-1)'));
			assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 1);
		});

		test('an unknown tool throws unknown_tool', async () => {
			useSession();
			await assert.rejects(
				callTool({ action: 'mcp.callTool', name: 'no_such_tool' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		});

		test('the chat GraphQL write tool is not callable over MCP', async () => {
			useSession();
			await assert.rejects(
				callTool({ action: 'mcp.callTool', name: 'rewst_graphql', arguments: { orgId: 'org-1' } }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		});

		test('an org-scoped tool without orgId throws org_required', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool({ action: 'mcp.callTool', name: 'list_templates' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'org_required',
			);
		});

		test('an unmanaged org throws org_not_found', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool(
					{ action: 'mcp.callTool', name: 'list_templates', arguments: { orgId: 'org-999' } },
					settings(),
				),
				(error: unknown) => error instanceof McpError && error.code === 'org_not_found',
			);
		});

		test('no active sessions throws no_session', async () => {
			await assert.rejects(
				callTool({ action: 'mcp.callTool', name: 'list_orgs' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'no_session',
			);
		});

		test('a capability that throws comes back as an isError tool result, not a transport error', async () => {
			const { wrapper } = useSession('org-1');
			wrapper.when('getTemplate', { error: Fixtures.notFoundError('Template') });
			const result = await okResult(
				callTool(
					{
						action: 'mcp.callTool',
						name: 'get_template',
						arguments: { orgId: 'org-1', templateId: 'missing' },
					},
					settings(),
				),
			);
			assert.strictEqual(result.isError, true);
		});

		test('exceeding the call rate throws rate_limited', async () => {
			useSession('org-1');
			let limited = false;
			for (let i = 0; i < 40 && !limited; i++) {
				try {
					await callTool({ action: 'mcp.callTool', name: 'list_orgs' }, settings());
				} catch (error) {
					if (error instanceof McpError && error.code === 'rate_limited') limited = true;
					else throw error;
				}
			}
			assert.ok(limited, 'the throttle eventually rejects a burst of calls');
		});
	});

	suite('handleMcpRequest() gate', () => {
		test('returns mcp_disabled (403) when the setting is off (default)', async () => {
			const { statusCode, body } = await handleMcpRequest({ action: 'mcp.listTools' }, {});
			assert.strictEqual(statusCode, 403);
			assert.ok(!body.ok && body.error.code === 'mcp_disabled');
		});

		suite('with mcp.enable on', () => {
			setup(async () => {
				await vscode.workspace
					.getConfiguration('rewst-buddy.mcp')
					.update('enable', true, vscode.ConfigurationTarget.Global);
			});
			teardown(async () => {
				await vscode.workspace
					.getConfiguration('rewst-buddy.mcp')
					.update('enable', undefined, vscode.ConfigurationTarget.Global);
			});

			test('rejects a missing/invalid token with bad_token (401)', async () => {
				rotateMcpToken();
				const { statusCode, body } = await handleMcpRequest({ action: 'mcp.listTools' }, { token: 'wrong' });
				assert.strictEqual(statusCode, 401);
				assert.ok(!body.ok && body.error.code === 'bad_token');
			});

			test('rejects a mismatched protocol version (409)', async () => {
				const token = rotateMcpToken();
				const { statusCode, body } = await handleMcpRequest(
					{ action: 'mcp.listTools' },
					{ token, protocolVersion: String(MCP_PROTOCOL_VERSION + 1) },
				);
				assert.strictEqual(statusCode, 409);
				assert.ok(!body.ok && body.error.code === 'version_mismatch');
			});

			test('a valid token lists tools', async () => {
				const token = rotateMcpToken();
				const { statusCode, body } = await handleMcpRequest(
					{ action: 'mcp.listTools' },
					{ token, protocolVersion: String(MCP_PROTOCOL_VERSION) },
				);
				assert.strictEqual(statusCode, 200);
				assert.ok(body.ok);
				const tools = (body.result as { tools: { name: string }[] }).tools;
				assert.ok(tools.some(tool => tool.name === 'list_orgs'));
			});
		});
	});
});
