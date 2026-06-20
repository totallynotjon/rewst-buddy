import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import { McpError, _resetMcpThrottleForTesting, callTool, listResources, listTools, readResource } from './McpActions';
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
			assert.ok(!names.includes('buddy_graphql'), 'chat write tool is not on MCP');
			assert.ok(!names.includes('buddy_graphql_schema'), 'chat schema tool is not on MCP');
		});

		test('an allowlist restricts the exposed tools', () => {
			const names = listTools(settings({ enabledTools: ['list_orgs'] })).map(tool => tool.name);
			assert.deepStrictEqual(names, ['list_orgs']);
		});
	});

	suite('callTool()', () => {
		test('list_orgs enumerates orgs across active sessions without an orgId', async () => {
			useSession('org-1', 'Acme');
			const result = await callTool({ name: 'list_orgs' }, settings());
			assert.ok(result.text.includes('Acme (org-1)'));
			assert.ok(!result.isError);
		});

		test('list_templates returns template names for the org', async () => {
			const { wrapper } = useSession('org-1');
			wrapper.when('listTemplates', {
				data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't-1', name: 'Welcome' })]),
			});
			const result = await callTool({ name: 'list_templates', arguments: { orgId: 'org-1' } }, settings());
			assert.ok(result.text.includes('Welcome (t-1)'));
			assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 1);
		});

		test('an unknown tool throws unknown_tool', async () => {
			useSession();
			await assert.rejects(
				callTool({ name: 'no_such_tool' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		});

		test('the chat GraphQL write tool is not callable over MCP', async () => {
			useSession();
			await assert.rejects(
				callTool({ name: 'buddy_graphql', arguments: { orgId: 'org-1' } }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		});

		test('an org-scoped tool without orgId throws org_required', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool({ name: 'list_templates' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'org_required',
			);
		});

		test('an unmanaged org throws org_not_found', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool({ name: 'list_templates', arguments: { orgId: 'org-999' } }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'org_not_found',
			);
		});

		test('no active sessions throws no_session', async () => {
			await assert.rejects(
				callTool({ name: 'list_orgs' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'no_session',
			);
		});

		test('a capability that throws comes back as an isError tool result, not a thrown error', async () => {
			const { wrapper } = useSession('org-1');
			wrapper.when('getTemplate', { error: Fixtures.notFoundError('Template') });
			const result = await callTool(
				{ name: 'get_template', arguments: { orgId: 'org-1', templateId: 'missing' } },
				settings(),
			);
			assert.strictEqual(result.isError, true);
		});

		test('a write tool is rejected while write tools are disabled', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool(
					{ name: 'buddy_graphql', arguments: { orgId: 'org-1' } },
					settings({ enableWriteTools: true }),
				),
				// buddy_graphql is chat-only (mcp:false), so it stays unknown_tool even
				// with writes enabled — there is no MCP write tool in the foundation yet.
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		});

		test('exceeding the call rate throws rate_limited', async () => {
			useSession('org-1');
			let limited = false;
			for (let i = 0; i < 40 && !limited; i++) {
				try {
					await callTool({ name: 'list_orgs' }, settings());
				} catch (error) {
					if (error instanceof McpError && error.code === 'rate_limited') limited = true;
					else throw error;
				}
			}
			assert.ok(limited, 'the throttle eventually rejects a burst of calls');
		});
	});

	suite('resources honour the allowlist', () => {
		test('listResources advertises both collections per active org by default', () => {
			useSession('org-1', 'Acme');
			const uris = listResources(settings()).map(resource => resource.uri);
			assert.deepStrictEqual(uris.sort(), ['rewst://org-1/templates', 'rewst://org-1/workflows']);
		});

		test('listResources hides a collection whose list tool is not allowlisted', () => {
			useSession('org-1');
			const uris = listResources(settings({ enabledTools: ['list_templates'] })).map(resource => resource.uri);
			assert.deepStrictEqual(uris, ['rewst://org-1/templates']);
		});

		test('readResource rejects a resource whose backing tool is not allowlisted', async () => {
			useSession('org-1');
			await assert.rejects(
				readResource('rewst://org-1/templates', settings({ enabledTools: ['list_orgs'] })),
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		});

		test('readResource reads an allowlisted collection', async () => {
			const { wrapper } = useSession('org-1');
			wrapper.when('listTemplates', {
				data: Fixtures.listTemplatesQuery([Fixtures.template({ id: 't-1', name: 'Welcome' })]),
			});
			const content = await readResource(
				'rewst://org-1/templates',
				settings({ enabledTools: ['list_templates'] }),
			);
			assert.ok(content.text.includes('Welcome (t-1)'));
		});

		test('readResource is rate-limited after a burst', async () => {
			const { wrapper } = useSession('org-1');
			wrapper.when('listTemplates', { data: Fixtures.listTemplatesQuery([]) });
			let limited = false;
			for (let i = 0; i < 40 && !limited; i++) {
				try {
					await readResource('rewst://org-1/templates', settings({ enabledTools: ['list_templates'] }));
				} catch (error) {
					if (error instanceof McpError && error.code === 'rate_limited') limited = true;
					else throw error;
				}
			}
			assert.ok(limited, 'the throttle eventually rejects a burst of resource reads');
		});
	});
});
