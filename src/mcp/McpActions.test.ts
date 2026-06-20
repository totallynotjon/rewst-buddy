import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager, type Session } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import vscode from 'vscode';
import { _resetMcpMutationApproverForTesting, setMcpMutationApprover } from '../capabilities/graphqlMutateCapability';
import { _resetApprovedMutationScopes } from '../ui/chat/tools/graphqlTool';
import { McpError, _resetMcpThrottleForTesting, callTool, listResources, listTools, readResource } from './McpActions';
import type { McpSettings } from './settings';

const { suite, test, setup, teardown } = Mocha;

function settings(over: Partial<McpSettings> = {}): McpSettings {
	return { enable: true, enableWriteTools: false, enabledTools: [], ...over };
}

async function setAiTools(tools: string[]): Promise<void> {
	await vscode.workspace.getConfiguration('rewst-buddy.ai').update('tools', tools, vscode.ConfigurationTarget.Global);
}

/** A mock session managing one org, registered with the SessionManager. */
function useSession(orgId = 'org-1', orgName = 'Acme') {
	const { session, wrapper } = createMockSession({ profile: { org: { id: orgId, name: orgName } } });
	SessionManager._setSessionsForTesting([session]);
	return { session, wrapper };
}

function useRawGraphqlWrapper(session: Session, wrapper: ReturnType<typeof createMockSession>['wrapper']): void {
	const wrap = wrapper.getWrapper();
	(session as { rawGraphql: Session['rawGraphql'] }).rawGraphql = async (query, variables) => {
		return wrap(async () => ({ data: undefined, errors: undefined }), 'rawGraphql', detectGraphqlOperation(query), {
			query,
			variables,
		});
	};
}

function workflowGetResponse() {
	return {
		data: {
			workflow: {
				id: 'wf-1',
				name: 'MCP Sample Workflow',
				description: null,
				type: 'workflow',
				orgId: 'org-1',
				organization: { id: 'org-1', name: 'Acme' },
				action: { parameters: {} },
				updatedAt: '1000',
				input: [],
				tasks: [
					{
						id: 'task-start',
						name: 'start',
						actionId: 'action-noop',
						action: { id: 'action-noop', ref: 'core.noop', name: 'Noop' },
						input: {},
						next: [
							{
								id: 'transition-1',
								from: 'task-start',
								to: 'task-end',
								when: '{{ SUCCEEDED }}',
								do: ['task-end'],
							},
						],
					},
					{
						id: 'task-end',
						name: 'end',
						actionId: 'action-noop',
						action: { id: 'action-noop', ref: 'core.noop', name: 'Noop' },
						input: {},
						next: [],
					},
				],
			},
		},
	};
}

function detectGraphqlOperation(query: string): string {
	const match = /\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query);
	return match ? `${match[1]} ${match[2]}` : 'rawGraphql';
}

suite('Unit: McpActions', () => {
	setup(async () => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		_resetMcpThrottleForTesting();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		await setAiTools(['workspace', 'graphql']);
	});

	teardown(async () => {
		SessionManager._resetForTesting();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		await setAiTools(['workspace']);
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
			assert.ok(names.includes('buddy_graphql_schema'), 'schema introspection is available on MCP');
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

		test('buddy_graphql_schema is callable over MCP and returns a schema view', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', {
				data: {
					data: {
						__schema: {
							queryType: {
								name: 'Query',
								fields: [{ name: 'workflow', args: [], type: { name: 'Workflow' } }],
							},
							mutationType: {
								name: 'Mutation',
								fields: [{ name: 'updateWorkflow', args: [], type: { name: 'Workflow' } }],
							},
						},
					},
				},
			});

			const result = await callTool({ name: 'buddy_graphql_schema', arguments: {} }, settings());

			assert.ok(!result.isError);
			assert.ok(result.text.includes('## Query (Query)'));
			assert.ok(result.text.includes('workflow: Workflow'));
			const calls = wrapper.getCallsFor('rawGraphql');
			assert.strictEqual(calls.length, 1);
			assert.deepStrictEqual(calls[0].variables.variables, { includeDeprecated: false });
		});

		test('buddy_workflow_get is callable over MCP through the workflow capability', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', { data: workflowGetResponse() });
			await setAiTools(['workspace', 'workflows']);

			const names = listTools(settings()).map(tool => tool.name);
			assert.ok(names.includes('buddy_workflow_get'));

			const result = await callTool(
				{ name: 'buddy_workflow_get', arguments: { orgId: 'org-1', workflowId: 'wf-1' } },
				settings(),
			);

			assert.ok(!result.isError);
			const parsed = JSON.parse(result.text) as {
				workflow: { id: string; name: string; orgId: string; orgName: string };
				nodes: { name: string }[];
			};
			assert.strictEqual(parsed.workflow.name, 'MCP Sample Workflow');
			assert.strictEqual(parsed.workflow.orgName, 'Acme');
			assert.deepStrictEqual(
				parsed.nodes.map(node => node.name),
				['start', 'end'],
			);
			const calls = wrapper.getCallsFor('rawGraphql');
			assert.strictEqual(calls.length, 1);
			assert.match(calls[0].variables.query, /query RewstBuddyWorkflowGet/);
			assert.deepStrictEqual(calls[0].variables.variables, { where: { id: 'wf-1', orgId: 'org-1' } });
		});

		test('buddy_workflow_edit is not available over MCP', async () => {
			useSession('org-1');
			await setAiTools(['workspace', 'workflows']);

			const names = listTools(settings({ enableWriteTools: true })).map(tool => tool.name);
			assert.ok(!names.includes('buddy_workflow_edit'));
			await assert.rejects(
				callTool(
					{
						name: 'buddy_workflow_edit',
						arguments: {
							orgId: 'org-1',
							workflowId: 'wf-1',
							workflowName: 'Workflow',
							orgName: 'Acme',
							operations: [],
						},
					},
					settings({ enableWriteTools: true }),
				),
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

		test('rewst_graphql_mutate is rejected while write tools are disabled', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool(
					{
						name: 'rewst_graphql_mutate',
						arguments: {
							orgId: 'org-1',
							query: 'mutation UpdateThing { updateThing { id } }',
							scopeId: 'wf-1',
							scopeName: 'Workflow',
						},
					},
					settings({ enableWriteTools: false }),
				),
				(error: unknown) => error instanceof McpError && error.code === 'write_disabled',
			);
		});

		test('rewst_graphql_mutate is hidden and rejected when GraphQL tools are off', async () => {
			useSession('org-1');
			await setAiTools(['workspace']);

			const names = listTools(settings({ enableWriteTools: true })).map(tool => tool.name);
			assert.ok(!names.includes('rewst_graphql_mutate'));
			await assert.rejects(
				callTool(
					{
						name: 'rewst_graphql_mutate',
						arguments: {
							orgId: 'org-1',
							query: 'mutation UpdateThing { updateThing { id } }',
							scopeId: 'wf-1',
							scopeName: 'Workflow',
						},
					},
					settings({ enableWriteTools: true }),
				),
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		});

		test('rewst_graphql_mutate returns an error result for query documents', async () => {
			useSession('org-1');
			const result = await callTool(
				{
					name: 'rewst_graphql_mutate',
					arguments: {
						orgId: 'org-1',
						query: 'query ReadThing { thing { id } }',
						scopeId: 'wf-1',
						scopeName: 'Workflow',
					},
				},
				settings({ enableWriteTools: true }),
			);
			assert.strictEqual(result.isError, true);
			assert.ok(result.text.includes('use rewst_graphql_query'));
		});

		test('rewst_graphql_mutate returns an error result for subscriptions', async () => {
			useSession('org-1');
			const result = await callTool(
				{
					name: 'rewst_graphql_mutate',
					arguments: {
						orgId: 'org-1',
						query: 'subscription WatchThing { thingChanged { id } }',
						scopeId: 'wf-1',
						scopeName: 'Workflow',
					},
				},
				settings({ enableWriteTools: true }),
			);
			assert.strictEqual(result.isError, true);
			assert.ok(result.text.includes('Subscriptions are not supported'));
		});

		test('rewst_graphql_mutate returns approval_required without executing when the user declines', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			setMcpMutationApprover(async () => false);

			const result = await callTool(
				{
					name: 'rewst_graphql_mutate',
					arguments: {
						orgId: 'org-1',
						query: 'mutation UpdateThing { updateThing { id } }',
						scopeId: 'wf-1',
						scopeName: 'Workflow',
					},
				},
				settings({ enableWriteTools: true }),
			);

			assert.ok(!result.isError);
			assert.strictEqual(JSON.parse(result.text).status, 'approval_required');
			assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 0);
		});

		test('rewst_graphql_mutate executes after approval and remembers the same scope', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme Org');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', { data: { data: { updateThing: { id: 'wf-1' } } } });
			let approvals = 0;
			setMcpMutationApprover(async () => {
				approvals++;
				return true;
			});
			const args = {
				orgId: 'org-1',
				query: 'mutation UpdateThing($name: String!) { updateThing(name: $name) { id } }',
				variables: { name: 'Renamed' },
				scopeId: 'wf-1',
				scopeName: 'Workflow',
			};

			const first = await callTool(
				{ name: 'rewst_graphql_mutate', arguments: args },
				settings({ enableWriteTools: true }),
			);
			const second = await callTool(
				{ name: 'rewst_graphql_mutate', arguments: args },
				settings({ enableWriteTools: true }),
			);

			assert.ok(!first.isError);
			assert.ok(first.text.includes('"updateThing"'));
			assert.ok(!second.isError);
			const calls = wrapper.getCallsFor('rawGraphql');
			assert.strictEqual(calls.length, 2);
			assert.strictEqual(approvals, 1);
			assert.deepStrictEqual(calls[0].variables.variables, { name: 'Renamed' });
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
