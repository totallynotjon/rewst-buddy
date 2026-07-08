import { MCP_MAX_OUTPUT_CHARS, RESULT_READ_TOOL_NAME, _resetMcpResultCacheForTesting } from '@capabilities';
import { WorkingScopeManager } from '@models';
import { SessionManager, type Session } from '@sessions';
import { Fixtures, createMockSession, initTestEnvironment } from '@test';
import { log } from '@utils';
import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_DIAGNOSE_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
} from '@workflow';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetMcpMutationApproverForTesting, setMcpMutationApprover } from '../capabilities/graphqlMutateCapability';
import { _resetApprovedMutationScopes } from '../ui/chat/tools/graphqlTool';
import { McpError, _resetMcpThrottleForTesting, callTool, listResources, listTools, readResource } from './McpActions';
import type { McpSettings } from './settings';

const { suite, test, setup, teardown } = Mocha;

function settings(over: Partial<McpSettings> = {}): McpSettings {
	return {
		enable: true,
		enableWriteTools: false,
		enableDangerousGraphqlMutation: false,
		alwaysAllowedOrgs: [],
		workingOrgScope: 'strict',
		...over,
	};
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

function workflowMutationRawGraphqlResponse(request: { query?: string }): { data: unknown } {
	const query = request.query ?? '';
	if (query.includes('RewstBuddyWorkflowGet')) {
		return { data: workflowGetResponse() };
	}
	if (query.includes('RewstBuddyWorkflowUpdate')) {
		return { data: { data: { updateWorkflow: { id: 'wf-1', name: 'MCP Sample Workflow', updatedAt: '2000' } } } };
	}
	throw new Error(`Unexpected rawGraphql operation in workflow mutation test: ${query}`);
}

function workflowRunRawGraphqlResponse(request: { query?: string }): { data: unknown } {
	const query = request.query ?? '';
	if (query.includes('RewstBuddyTestWorkflow')) {
		return { data: { data: { testWorkflow: { executionId: 'exec-new' } } } };
	}
	throw new Error(`Unexpected rawGraphql operation in workflow run test: ${query}`);
}

function detectGraphqlOperation(query: string): string {
	const match = /\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query);
	return match ? `${match[1]} ${match[2]}` : 'rawGraphql';
}

function captureInfoLogs(): { messages: string[]; restore: () => void } {
	const messages: string[] = [];
	const originalInfo = log.info;
	log.info = (message: string, ...args: unknown[]) => {
		messages.push([message, ...args.map(String)].join(' '));
	};
	return {
		messages,
		restore: () => {
			log.info = originalInfo;
		},
	};
}

function auditLines(messages: string[]): string[] {
	return messages.filter(message => message.includes('[MCP audit]'));
}

suite('Unit: McpActions', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
		_resetMcpThrottleForTesting();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		_resetMcpResultCacheForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		_resetMcpResultCacheForTesting();
	});

	suite('listTools()', () => {
		test('exposes the read tools and hides the GraphQL chat/write tools', () => {
			const names = listTools(settings()).map(tool => tool.name);
			assert.ok(names.includes('buddy_list_orgs'));
			assert.ok(names.includes('buddy_search_templates'));
			assert.ok(names.includes('buddy_get_template'));
			assert.ok(names.includes('buddy_list_workflows'));
			assert.ok(names.includes('buddy_get_workflow'));
			assert.ok(names.includes('buddy_graphql_query'), 'read-only GraphQL query is available on MCP');
			assert.ok(names.includes('buddy_search_template_links'), 'workspace helper is available on MCP');
			assert.ok(names.includes('buddy_template_link_status'), 'per-file link status is available on MCP');
			assert.ok(names.includes(RESULT_READ_TOOL_NAME), 'cached-result reader is available on MCP');
			assert.ok(!names.includes('buddy_graphql'), 'chat write tool is not on MCP');
			assert.ok(names.includes('buddy_graphql_schema'), 'schema introspection is available on MCP');
			assert.ok(!names.includes('buddy_graphql_mutate'), 'raw GraphQL mutation needs its own dangerous toggle');
		});
	});

	suite('callTool()', () => {
		test('buddy_list_orgs enumerates orgs across active sessions without an orgId', async () => {
			useSession('org-1', 'Acme');
			const result = await callTool({ name: 'buddy_list_orgs' }, settings());
			assert.ok(result.text.includes('Acme (org-1)'));
			assert.ok(!result.isError);
		});

		test('buddy_search_templates returns template names for the org', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', {
				data: {
					data: {
						templates: [
							{ id: 't-1', name: 'Welcome', language: 'html', contentType: 'email', updatedAt: null },
						],
					},
				},
			});
			const result = await callTool(
				{ name: 'buddy_search_templates', arguments: { orgId: 'org-1' } },
				settings(),
			);
			assert.ok(result.text.includes('Welcome (t-1)'));
			assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 1);
		});

		test('oversized tool output returns a cached preview that buddy_result_read can page', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			const templates = Array.from({ length: 200 }, (_, i) => ({
				id: `template-${i + 1}`,
				name: `Template ${i + 1} ${'x'.repeat(180)}`,
				language: 'html',
				contentType: 'email',
				updatedAt: null,
			}));
			wrapper.when('rawGraphql', { data: { data: { templates } } });

			const first = await callTool({ name: 'buddy_search_templates', arguments: { orgId: 'org-1' } }, settings());
			const id = /"id":"([^"]+)"/.exec(first.text)?.[1];

			assert.ok(id, 'oversized output includes a cached result id');
			assert.ok(first.text.startsWith('Template 1'));
			assert.ok(first.text.includes(`"offset":${MCP_MAX_OUTPUT_CHARS}`));
			assert.ok(first.text.includes(RESULT_READ_TOOL_NAME));
			assert.ok(
				first.text.length < templates.map(template => `${template.name} (${template.id})`).join('\n').length,
			);
			const rawCalls = wrapper.getCallsFor('rawGraphql');
			assert.strictEqual(rawCalls.length, 1, 'the org templates are fetched once for the oversized call');
			assert.strictEqual(
				rawCalls[0].variables.variables.orgId,
				'org-1',
				'buddy_search_templates is scoped to the requested org',
			);

			const second = await callTool(
				{ name: RESULT_READ_TOOL_NAME, arguments: { id, offset: MCP_MAX_OUTPUT_CHARS } },
				settings(),
			);

			assert.ok(!second.isError);
			assert.ok(second.text.startsWith(`Cached result "${id}" (buddy_search_templates)`));
			assert.ok(second.text.includes(`characters ${MCP_MAX_OUTPUT_CHARS}-`));
			assert.ok(second.text.includes('Template'));
			assert.strictEqual(
				wrapper.getCallsFor('rawGraphql').length,
				1,
				'paging serves from the in-memory cache without re-hitting the API',
			);
		});

		test('buddy_search_template_links is callable over MCP without an orgId', async () => {
			useSession('org-1');
			const result = await callTool({ name: 'buddy_search_template_links', arguments: {} }, settings());
			assert.ok(!result.isError);
			assert.match(result.text, /No files are linked to Rewst templates/);
		});

		test('buddy_template_link_status reports linked:false for an unlinked file without an orgId', async () => {
			useSession('org-1');
			const result = await callTool(
				{ name: 'buddy_template_link_status', arguments: { uri: '/ws/unlinked.j2' } },
				settings(),
			);
			assert.ok(!result.isError);
			assert.match(result.text, /"linked":\s*false/);
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

		test('workflow write helpers are listed only when MCP write tools are enabled', async () => {
			useSession('org-1');

			const withoutWrite = listTools(settings()).map(tool => tool.name);
			assert.ok(!withoutWrite.includes(WORKFLOW_EDIT_TOOL_NAME));
			assert.ok(!withoutWrite.includes(WORKFLOW_AUTOLAYOUT_TOOL_NAME));
			assert.ok(!withoutWrite.includes(WORKFLOW_RUN_TOOL_NAME));

			const names = listTools(settings({ enableWriteTools: true })).map(tool => tool.name);
			assert.ok(names.includes(WORKFLOW_EDIT_TOOL_NAME));
			assert.ok(names.includes(WORKFLOW_AUTOLAYOUT_TOOL_NAME));
			assert.ok(names.includes(WORKFLOW_RUN_TOOL_NAME));
		});

		test('buddy_workflow_edit is rejected at the boundary while write tools are disabled', async () => {
			useSession('org-1');

			await assert.rejects(
				callTool(
					{
						name: WORKFLOW_EDIT_TOOL_NAME,
						arguments: {
							orgId: 'org-1',
							workflowId: 'wf-1',
							workflowName: 'Workflow',
							orgName: 'Acme',
							operations: [],
						},
					},
					settings({ enableWriteTools: false }),
				),
				(error: unknown) => error instanceof McpError && error.code === 'write_disabled',
			);
		});

		function workflowEditCall(orgId = 'org-1', workflowId = 'wf-1') {
			return {
				name: WORKFLOW_EDIT_TOOL_NAME,
				arguments: {
					orgId,
					workflowId,
					workflowName: 'MCP Sample Workflow',
					orgName: 'Acme',
					operations: [{ op: 'reposition', task: 'start', x: 1, y: 2 }],
				},
			};
		}

		test('a write with no working org and no always-allowed org is rejected', async () => {
			useSession('org-1');

			await assert.rejects(
				callTool(workflowEditCall(), settings({ enableWriteTools: true })),
				(error: unknown) => error instanceof McpError && error.code === 'org_out_of_scope',
			);
		});

		test('a write to an org outside the effective scope is rejected', async () => {
			useSession('org-1');

			await assert.rejects(
				callTool(workflowEditCall(), settings({ enableWriteTools: true, alwaysAllowedOrgs: ['org-other'] })),
				(error: unknown) => error instanceof McpError && error.code === 'org_out_of_scope',
			);
		});

		test('a write to an always-allowed org passes the boundary guard', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme');
			useRawGraphqlWrapper(session, wrapper);
			setMcpMutationApprover(async () => false);

			const result = await callTool(
				workflowEditCall(),
				settings({ enableWriteTools: true, alwaysAllowedOrgs: ['org-1'] }),
			);

			// Past the scope guard; stopped only at approval (declined here).
			assert.strictEqual(JSON.parse(result.text).status, 'approval_required');
		});

		test('a write to a pinned working org passes the boundary guard', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme');
			useRawGraphqlWrapper(session, wrapper);
			setMcpMutationApprover(async () => false);
			WorkingScopeManager.setOrgs(['org-1']);

			const result = await callTool(workflowEditCall(), settings({ enableWriteTools: true }));

			assert.strictEqual(JSON.parse(result.text).status, 'approval_required');
		});

		test('a write to a workflow outside the working workflows is rejected', async () => {
			useSession('org-1');
			WorkingScopeManager.setOrgs(['org-1']);
			WorkingScopeManager.setWorkflows(['wf-other']);

			await assert.rejects(
				callTool(workflowEditCall('org-1', 'wf-1'), settings({ enableWriteTools: true })),
				(error: unknown) => error instanceof McpError && error.code === 'workflow_out_of_scope',
			);
		});

		test('a write to a pinned working workflow passes the boundary guard', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme');
			useRawGraphqlWrapper(session, wrapper);
			setMcpMutationApprover(async () => false);
			WorkingScopeManager.setOrgs(['org-1']);
			WorkingScopeManager.setWorkflows(['wf-1']);

			const result = await callTool(workflowEditCall('org-1', 'wf-1'), settings({ enableWriteTools: true }));

			assert.strictEqual(JSON.parse(result.text).status, 'approval_required');
		});

		test('a read outside the working orgs is rejected under strict scope', async () => {
			useSession('org-1');
			WorkingScopeManager.setOrgs(['org-other']);

			await assert.rejects(
				callTool({ name: 'buddy_search_templates', arguments: { orgId: 'org-1' } }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'org_out_of_scope',
			);
		});

		test('reads stay cross-org when nothing is pinned', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', { data: { data: { templates: [] } } });

			const result = await callTool(
				{ name: 'buddy_search_templates', arguments: { orgId: 'org-1' } },
				settings(),
			);

			assert.ok(!result.isError);
		});

		test('writes-only scope leaves reads unrestricted even when a working org is pinned', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', { data: { data: { templates: [] } } });
			WorkingScopeManager.setOrgs(['org-other']);

			const result = await callTool(
				{ name: 'buddy_search_templates', arguments: { orgId: 'org-1' } },
				settings({ workingOrgScope: 'writes' }),
			);

			assert.ok(!result.isError);
		});

		test('omitting orgId targets the sole pinned working org', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', {
				data: {
					data: {
						templates: [
							{ id: 't-1', name: 'Welcome', language: 'html', contentType: 'email', updatedAt: null },
						],
					},
				},
			});
			WorkingScopeManager.setOrgs(['org-1']);

			const result = await callTool({ name: 'buddy_search_templates' }, settings());

			assert.ok(result.text.includes('Welcome (t-1)'));
			assert.strictEqual(wrapper.getCallsFor('rawGraphql')[0].variables.variables.orgId, 'org-1');
		});

		test('the working scope does not restrict org-discovery tools', async () => {
			useSession('org-1', 'Acme');
			WorkingScopeManager.setOrgs(['org-other']);

			const result = await callTool({ name: 'buddy_list_orgs' }, settings());

			assert.ok(result.text.includes('Acme (org-1)'));
			assert.ok(!result.isError);
		});

		test('an out-of-scope call is rejected before the session is validated', async () => {
			const { session } = useSession('org-1');
			WorkingScopeManager.setOrgs(['org-other']);
			let validated = 0;
			(session as unknown as { validate: () => Promise<boolean> }).validate = async () => {
				validated++;
				return true;
			};

			await assert.rejects(
				callTool({ name: 'buddy_search_templates', arguments: { orgId: 'org-1' } }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'org_out_of_scope',
			);
			assert.strictEqual(validated, 0, 'no authenticated session I/O happens for an out-of-scope request');
		});

		/** Active sessions whose task-log reads are stubbed per org, for execution-log scope tests. */
		function useTaskLogSessions(rowsByOrg: Record<string, unknown[]>) {
			const calls: Record<string, number> = {};
			const sessions = Object.keys(rowsByOrg).map(orgId => {
				calls[orgId] = 0;
				const { session } = createMockSession({ profile: { org: { id: orgId, name: orgId } } });
				(session as { rawGraphql: Session['rawGraphql'] }).rawGraphql = (async query => {
					calls[orgId]++;
					if (query.includes('RewstBuddyExecutions')) {
						return { data: { workflowExecutions: [{ id: 'exec-1', orgId }] } };
					}
					return { data: { taskLogs: rowsByOrg[orgId] } };
				}) as Session['rawGraphql'];
				return session;
			});
			SessionManager._setSessionsForTesting(sessions);
			return { calls };
		}

		const OTHER_ORG_ROW = { originalWorkflowTaskName: 'other_org_task', status: 'succeeded' };

		test('buddy_execution_logs with an out-of-scope orgId is rejected under strict scope', async () => {
			const { calls } = useTaskLogSessions({ 'org-1': [], 'org-2': [OTHER_ORG_ROW] });
			WorkingScopeManager.setOrgs(['org-1']);

			await assert.rejects(
				callTool(
					{
						name: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
						arguments: { executionId: 'exec-1', orgId: 'org-2' },
					},
					settings(),
				),
				(error: unknown) => error instanceof McpError && error.code === 'org_out_of_scope',
			);
			assert.strictEqual(calls['org-2'], 0, 'no authenticated traffic reaches the out-of-scope org');
		});

		test('buddy_execution_logs rejects a top-level out-of-scope orgId under strict scope', async () => {
			const { calls } = useTaskLogSessions({ 'org-1': [], 'org-2': [OTHER_ORG_ROW] });
			WorkingScopeManager.setOrgs(['org-1']);

			await assert.rejects(
				callTool(
					{
						name: WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
						orgId: 'org-2',
						arguments: { executionId: 'exec-1' },
					},
					settings(),
				),
				(error: unknown) => error instanceof McpError && error.code === 'org_out_of_scope',
			);
			assert.strictEqual(calls['org-2'], 0, 'top-level orgId is checked before authenticated traffic');
		});

		test('the buddy_execution_logs sweep skips sessions outside the working scope under strict scope', async () => {
			const { calls } = useTaskLogSessions({ 'org-1': [], 'org-2': [OTHER_ORG_ROW] });
			WorkingScopeManager.setOrgs(['org-1']);

			const result = await callTool(
				{ name: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, arguments: { executionId: 'exec-1' } },
				settings(),
			);

			assert.ok(!result.isError);
			assert.strictEqual(calls['org-2'], 0, 'the out-of-scope session is never queried');
			assert.ok(!result.text.includes('other_org_task'), 'no out-of-scope rows leak into the result');
		});

		test('buddy_execution_logs does not leak an out-of-scope execution from the same multi-org session', async () => {
			let taskLogReads = 0;
			const { session } = createMockSession({
				profile: {
					org: { id: 'org-1', name: 'Allowed' },
					allManagedOrgs: [
						{ id: 'org-1', name: 'Allowed' },
						{ id: 'org-2', name: 'Blocked' },
					],
				},
			});
			(session as { rawGraphql: Session['rawGraphql'] }).rawGraphql = (async query => {
				if (query.includes('RewstBuddyExecutions')) {
					return { data: { workflowExecutions: [] } };
				}
				if (query.includes('RewstBuddyTaskLogs')) {
					taskLogReads++;
					return { data: { taskLogs: [OTHER_ORG_ROW] } };
				}
				return { data: {} };
			}) as Session['rawGraphql'];
			SessionManager._setSessionsForTesting([session]);
			WorkingScopeManager.setOrgs(['org-1']);

			const result = await callTool(
				{ name: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, arguments: { executionId: 'exec-1' } },
				settings(),
			);

			assert.match(result.text, /Execution exec-1.*org org-1/i, 'ownership failure is surfaced to the caller');
			assert.ok(!result.text.includes('other_org_task'), 'the blocked org task row is not returned');
			assert.strictEqual(taskLogReads, 0, 'task logs are not queried until execution ownership is proven');
		});

		test('the buddy_execution_logs sweep stays cross-session when no working org is pinned', async () => {
			const { calls } = useTaskLogSessions({ 'org-1': [], 'org-2': [OTHER_ORG_ROW] });

			const result = await callTool(
				{ name: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, arguments: { executionId: 'exec-1' } },
				settings(),
			);

			assert.ok(result.text.includes('other_org_task'), 'the alternate session recovers the logs');
			assert.match(result.text, /found via another active session/);
			assert.ok(calls['org-2'] > 0, 'the sweep reaches the other session');
		});

		test('buddy_workflow_diagnose with an out-of-scope orgId is rejected under strict scope', async () => {
			const { calls } = useTaskLogSessions({ 'org-1': [], 'org-2': [OTHER_ORG_ROW] });
			WorkingScopeManager.setOrgs(['org-1']);

			await assert.rejects(
				callTool(
					{
						name: WORKFLOW_DIAGNOSE_TOOL_NAME,
						arguments: { executionId: 'exec-1', orgId: 'org-2' },
					},
					settings(),
				),
				(error: unknown) => error instanceof McpError && error.code === 'org_out_of_scope',
			);
			assert.strictEqual(calls['org-2'] ?? 0, 0, 'no traffic to the out-of-scope org');
		});

		test('the buddy_workflow_diagnose sweep skips sessions outside the working scope under strict scope', async () => {
			const { calls } = useTaskLogSessions({ 'org-1': [], 'org-2': [OTHER_ORG_ROW] });
			WorkingScopeManager.setOrgs(['org-1']);

			const result = await callTool(
				{ name: WORKFLOW_DIAGNOSE_TOOL_NAME, arguments: { executionId: 'exec-1' } },
				settings({ alwaysAllowedOrgs: ['org-1'] }),
			);

			assert.ok(!result.isError, 'call succeeds for the in-scope session');
			assert.strictEqual(calls['org-2'] ?? 0, 0, 'out-of-scope session is not swept');
			assert.ok(!result.text.includes('other_org_task'), 'out-of-scope task row is not returned');
		});

		test('the buddy_workflow_diagnose sweep stays cross-session when no working org is pinned', async () => {
			const failedOtherOrgRow = { ...OTHER_ORG_ROW, status: 'failed' };
			const { calls } = useTaskLogSessions({ 'org-1': [], 'org-2': [failedOtherOrgRow] });

			const result = await callTool(
				{ name: WORKFLOW_DIAGNOSE_TOOL_NAME, arguments: { executionId: 'exec-1' } },
				settings(),
			);

			assert.ok(result.text.includes('other_org_task'), 'the alternate session recovers the logs');
			assert.match(result.text, /found via another active session/);
			assert.ok(calls['org-2'] > 0, 'the sweep reaches the other session');
		});

		test('buddy_graphql_mutate against an out-of-scope workflow is rejected via scopeId', async () => {
			useSession('org-1');
			WorkingScopeManager.setOrgs(['org-1']);
			WorkingScopeManager.setWorkflows(['wf-allowed']);

			await assert.rejects(
				callTool(
					{
						name: 'buddy_graphql_mutate',
						arguments: {
							orgId: 'org-1',
							query: 'mutation M { updateWorkflow { id } }',
							scopeId: 'wf-other',
							scopeName: 'Workflow',
						},
					},
					settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
				),
				(error: unknown) => error instanceof McpError && error.code === 'workflow_out_of_scope',
			);
		});

		test('buddy_graphql_mutate is blocked when the org is out of scope', async () => {
			useSession('org-1');

			await assert.rejects(
				callTool(
					{
						name: 'buddy_graphql_mutate',
						arguments: {
							orgId: 'org-1',
							query: 'mutation M { updateThing { id } }',
							scopeId: 'thing-1',
							scopeName: 'Thing',
						},
					},
					settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-other'] }),
				),
				(error: unknown) => error instanceof McpError && error.code === 'org_out_of_scope',
			);
		});

		test('buddy_graphql_mutate passes the guard when the org is in scope', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme');
			useRawGraphqlWrapper(session, wrapper);
			setMcpMutationApprover(async () => false);

			const result = await callTool(
				{
					name: 'buddy_graphql_mutate',
					arguments: {
						orgId: 'org-1',
						query: 'mutation M { updateThing { id } }',
						scopeId: 'thing-1',
						scopeName: 'Thing',
					},
				},
				settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
			);

			// Past the scope guard; stopped only at approval (declined here).
			assert.strictEqual(JSON.parse(result.text).status, 'approval_required');
		});

		test('buddy_workflow_edit returns approval_required without executing when the user declines', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme');
			useRawGraphqlWrapper(session, wrapper);
			setMcpMutationApprover(async () => false);

			const result = await callTool(
				{
					name: WORKFLOW_EDIT_TOOL_NAME,
					arguments: {
						orgId: 'org-1',
						workflowId: 'wf-1',
						workflowName: 'MCP Sample Workflow',
						orgName: 'Acme',
						operations: [{ op: 'reposition', task: 'start', x: 100, y: 200 }],
					},
				},
				settings({ enableWriteTools: true, alwaysAllowedOrgs: ['org-1'] }),
			);

			assert.ok(!result.isError);
			assert.strictEqual(JSON.parse(result.text).status, 'approval_required');
			assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 0);
		});

		test('buddy_workflow_edit executes after MCP approval and returns workflow output', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when<unknown>('rawGraphql', workflowMutationRawGraphqlResponse);
			let approvals = 0;
			setMcpMutationApprover(async () => {
				approvals++;
				return true;
			});

			const result = await callTool(
				{
					name: WORKFLOW_EDIT_TOOL_NAME,
					arguments: {
						orgId: 'org-1',
						workflowId: 'wf-1',
						workflowName: 'MCP Sample Workflow',
						orgName: 'Acme',
						operations: [{ op: 'reposition', task: 'start', x: 100, y: 200 }],
					},
				},
				settings({ enableWriteTools: true, alwaysAllowedOrgs: ['org-1'] }),
			);

			assert.ok(!result.isError);
			assert.match(result.text, /Applied 1 operation/);
			assert.match(result.text, /New version token: 2000/);
			assert.strictEqual(approvals, 1);
			const calls = wrapper.getCallsFor('rawGraphql');
			assert.ok(calls.some(call => String(call.variables.query).includes('RewstBuddyWorkflowGet')));
			assert.ok(calls.some(call => String(call.variables.query).includes('RewstBuddyWorkflowUpdate')));
		});

		test('buddy_workflow_run asks for approval every time even after the workflow was approved', async () => {
			const { session, wrapper } = useSession('org-1', 'Acme');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when<unknown>('rawGraphql', workflowRunRawGraphqlResponse);
			let approvals = 0;
			setMcpMutationApprover(async () => {
				approvals++;
				return true;
			});
			const runRequest = {
				name: WORKFLOW_RUN_TOOL_NAME,
				arguments: {
					orgId: 'org-1',
					workflowId: 'wf-1',
					workflowName: 'MCP Sample Workflow',
					orgName: 'Acme',
					wait: false,
				},
			};

			const first = await callTool(
				runRequest,
				settings({ enableWriteTools: true, alwaysAllowedOrgs: ['org-1'] }),
			);
			const second = await callTool(
				runRequest,
				settings({ enableWriteTools: true, alwaysAllowedOrgs: ['org-1'] }),
			);

			assert.ok(!first.isError, first.text);
			assert.ok(!second.isError, second.text);
			assert.match(first.text, /exec-new/);
			assert.match(second.text, /exec-new/);
			assert.strictEqual(approvals, 2, 'running/testing a workflow requires a fresh modal every time');
		});

		test('an org-scoped tool without orgId throws org_required', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool({ name: 'buddy_search_templates' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'org_required',
			);
		});

		test('an unmanaged org throws org_not_found', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool({ name: 'buddy_search_templates', arguments: { orgId: 'org-999' } }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'org_not_found',
			);
		});

		test('no active sessions throws no_session', async () => {
			await assert.rejects(
				callTool({ name: 'buddy_list_orgs' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'no_session',
			);
		});

		test('a capability that throws comes back as an isError tool result, not a thrown error', async () => {
			const { wrapper } = useSession('org-1');
			wrapper.when('getTemplate', { error: Fixtures.notFoundError('Template') });
			const result = await callTool(
				{ name: 'buddy_get_template', arguments: { orgId: 'org-1', templateId: 'missing' } },
				settings(),
			);
			assert.strictEqual(result.isError, true);
		});

		test('buddy_graphql_mutate is rejected while the dangerous mutation toggle is disabled', async () => {
			useSession('org-1');
			await assert.rejects(
				callTool(
					{
						name: 'buddy_graphql_mutate',
						arguments: {
							orgId: 'org-1',
							query: 'mutation UpdateThing { updateThing { id } }',
							scopeId: 'wf-1',
							scopeName: 'Workflow',
						},
					},
					settings({ enableWriteTools: true, enableDangerousGraphqlMutation: false }),
				),
				(error: unknown) =>
					error instanceof McpError &&
					error.code === 'write_disabled' &&
					error.message.includes('rewst-buddy.mcp.enableDangerousGraphqlMutation'),
			);
		});

		test('buddy_graphql_mutate is not exposed by enableWriteTools alone', async () => {
			useSession('org-1');

			const names = listTools(settings({ enableWriteTools: true })).map(tool => tool.name);
			assert.ok(!names.includes('buddy_graphql_mutate'));
			await assert.rejects(
				callTool(
					{
						name: 'buddy_graphql_mutate',
						arguments: {
							orgId: 'org-1',
							query: 'mutation UpdateThing { updateThing { id } }',
							scopeId: 'wf-1',
							scopeName: 'Workflow',
						},
					},
					settings({ enableWriteTools: true }),
				),
				(error: unknown) =>
					error instanceof McpError &&
					error.code === 'write_disabled' &&
					error.message.includes('enableDangerousGraphqlMutation'),
			);
		});

		test('buddy_graphql_mutate is exposed by the dangerous toggle without enableWriteTools', () => {
			const names = listTools(
				settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
			).map(tool => tool.name);
			assert.ok(names.includes('buddy_graphql_mutate'));
			assert.ok(!names.includes(WORKFLOW_EDIT_TOOL_NAME));
			assert.ok(!names.includes(WORKFLOW_AUTOLAYOUT_TOOL_NAME));
			assert.ok(!names.includes(WORKFLOW_RUN_TOOL_NAME));
		});

		test('buddy_graphql_mutate returns an error result for query documents', async () => {
			useSession('org-1');
			const result = await callTool(
				{
					name: 'buddy_graphql_mutate',
					arguments: {
						orgId: 'org-1',
						query: 'query ReadThing { thing { id } }',
						scopeId: 'wf-1',
						scopeName: 'Workflow',
					},
				},
				settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
			);
			assert.strictEqual(result.isError, true);
			assert.ok(result.text.includes('use buddy_graphql_query'));
		});

		test('buddy_graphql_mutate returns an error result for subscriptions', async () => {
			useSession('org-1');
			const result = await callTool(
				{
					name: 'buddy_graphql_mutate',
					arguments: {
						orgId: 'org-1',
						query: 'subscription WatchThing { thingChanged { id } }',
						scopeId: 'wf-1',
						scopeName: 'Workflow',
					},
				},
				settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
			);
			assert.strictEqual(result.isError, true);
			assert.ok(result.text.includes('Subscriptions are not supported'));
		});

		test('buddy_graphql_mutate returns approval_required without executing when the user declines', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			setMcpMutationApprover(async () => false);

			const result = await callTool(
				{
					name: 'buddy_graphql_mutate',
					arguments: {
						orgId: 'org-1',
						query: 'mutation UpdateThing { updateThing { id } }',
						scopeId: 'wf-1',
						scopeName: 'Workflow',
					},
				},
				settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
			);

			assert.ok(!result.isError);
			assert.strictEqual(JSON.parse(result.text).status, 'approval_required');
			assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 0);
		});

		test('buddy_graphql_mutate executes after approval and remembers the same scope', async () => {
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
				{ name: 'buddy_graphql_mutate', arguments: args },
				settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
			);
			const second = await callTool(
				{ name: 'buddy_graphql_mutate', arguments: args },
				settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
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
					await callTool({ name: 'buddy_list_orgs' }, settings());
				} catch (error) {
					if (error instanceof McpError && error.code === 'rate_limited') limited = true;
					else throw error;
				}
			}
			assert.ok(limited, 'the throttle eventually rejects a burst of calls');
		});
	});

	suite('resources', () => {
		test('listResources advertises both collections per active org by default', () => {
			useSession('org-1', 'Acme');
			const uris = listResources(settings()).map(resource => resource.uri);
			assert.deepStrictEqual(uris.sort(), ['rewst://org-1/templates', 'rewst://org-1/workflows']);
		});

		test('readResource reads a collection', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', {
				data: {
					data: {
						templates: [
							{ id: 't-1', name: 'Welcome', language: 'html', contentType: 'email', updatedAt: null },
						],
					},
				},
			});
			const content = await readResource('rewst://org-1/templates', settings());
			assert.ok(content.text.includes('Welcome (t-1)'));
		});

		test('readResource is rate-limited after a burst', async () => {
			const { session, wrapper } = useSession('org-1');
			useRawGraphqlWrapper(session, wrapper);
			wrapper.when('rawGraphql', { data: { data: { templates: [] } } });
			let limited = false;
			for (let i = 0; i < 40 && !limited; i++) {
				try {
					await readResource('rewst://org-1/templates', settings());
				} catch (error) {
					if (error instanceof McpError && error.code === 'rate_limited') limited = true;
					else throw error;
				}
			}
			assert.ok(limited, 'the throttle eventually rejects a burst of resource reads');
		});
	});
});

suite('Unit: MCP audit logging', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
		_resetMcpThrottleForTesting();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	test('successful tool call logs tool, resolved orgId, ok outcome, and duration', async () => {
		const { session, wrapper } = useSession('org-1');
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					templates: [
						{ id: 't-1', name: 'Welcome', language: 'html', contentType: 'email', updatedAt: null },
					],
				},
			},
		});
		const capture = captureInfoLogs();
		try {
			await callTool({ name: 'buddy_search_templates', arguments: { orgId: 'org-1' } }, settings());
		} finally {
			capture.restore();
		}

		const lines = auditLines(capture.messages);
		assert.strictEqual(lines.length, 1);
		assert.ok(lines[0].includes('tool=buddy_search_templates'));
		assert.ok(lines[0].includes('orgId=org-1'));
		assert.ok(lines[0].includes('outcome=ok'));
		assert.match(lines[0], /durationMs=\d+/);
	});

	test('rejected tool call logs the McpError outcome', async () => {
		useSession('org-1');
		const capture = captureInfoLogs();
		try {
			await assert.rejects(
				callTool({ name: 'buddy_search_templates' }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'org_required',
			);
		} finally {
			capture.restore();
		}

		const lines = auditLines(capture.messages);
		assert.strictEqual(lines.length, 1);
		assert.ok(lines[0].includes('tool=buddy_search_templates'));
		assert.ok(lines[0].includes('orgId=—'));
		assert.ok(lines[0].includes('outcome=error:org_required'));
		assert.match(lines[0], /durationMs=\d+/);
	});

	test('a tool name with line breaks cannot forge extra audit lines', async () => {
		useSession('org-1');
		const capture = captureInfoLogs();
		try {
			await assert.rejects(
				callTool({ name: 'evil\n[MCP audit] tool=forged', arguments: { orgId: 'org-1' } }, settings()),
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		} finally {
			capture.restore();
		}

		const lines = auditLines(capture.messages);
		assert.strictEqual(lines.length, 1, 'the injected newline does not split the record into two audit lines');
		assert.ok(!lines[0].includes('\n'), 'the audit line carries no embedded newline');
		assert.ok(lines[0].includes('outcome=error:unknown_tool'));
	});

	test('a tool name with unicode line/paragraph separators cannot forge audit lines', async () => {
		useSession('org-1');
		const capture = captureInfoLogs();
		try {
			await assert.rejects(
				callTool(
					{ name: 'evil\u2028[MCP audit] tool=forged\u2029x', arguments: { orgId: 'org-1' } },
					settings(),
				),
				(error: unknown) => error instanceof McpError && error.code === 'unknown_tool',
			);
		} finally {
			capture.restore();
		}

		const lines = auditLines(capture.messages);
		assert.strictEqual(lines.length, 1, 'unicode separators do not split the record');
		assert.ok(!/[\u2028\u2029]/.test(lines[0]), 'the audit line carries no unicode line separators');
	});

	test('audit logs do not include arguments or secrets', async () => {
		const { session, wrapper } = useSession('org-1');
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					templates: [
						{ id: 't-1', name: 'Welcome', language: 'html', contentType: 'email', updatedAt: null },
					],
				},
			},
		});
		const capture = captureInfoLogs();
		try {
			await callTool(
				{
					name: 'buddy_search_templates',
					arguments: {
						orgId: 'org-1',
						apiToken: 'audit-secret-token',
						query: 'query AuditSecret { secretField }',
						variables: { password: 'audit-secret-password' },
					},
				},
				settings(),
			);
		} finally {
			capture.restore();
		}

		const lines = auditLines(capture.messages);
		assert.strictEqual(lines.length, 1);
		const combined = lines.join('\n');
		assert.ok(!combined.includes('audit-secret-token'));
		assert.ok(!combined.includes('AuditSecret'));
		assert.ok(!combined.includes('secretField'));
		assert.ok(!combined.includes('audit-secret-password'));
	});

	test('scoped optional-org reads log their requested orgId', async () => {
		const { session } = useSession('org-1');
		(session as { rawGraphql: Session['rawGraphql'] }).rawGraphql = (async query => {
			if (query.includes('RewstBuddyExecutions')) {
				return { data: { workflowExecutions: [{ id: 'exec-1', orgId: 'org-1' }] } };
			}
			if (query.includes('RewstBuddyTaskLogs')) {
				return { data: { taskLogs: [] } };
			}
			return { data: {} };
		}) as Session['rawGraphql'];
		const capture = captureInfoLogs();
		try {
			await callTool(
				{ name: WORKFLOW_EXECUTION_LOGS_TOOL_NAME, arguments: { executionId: 'exec-1', orgId: 'org-1' } },
				settings(),
			);
		} finally {
			capture.restore();
		}

		const lines = auditLines(capture.messages);
		assert.strictEqual(lines.length, 1);
		assert.ok(lines[0].includes(`tool=${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}`));
		assert.ok(lines[0].includes('orgId=org-1'));
	});

	test('approval_required structured results log approval_required outcome', async () => {
		const { session, wrapper } = useSession('org-1');
		useRawGraphqlWrapper(session, wrapper);
		setMcpMutationApprover(async () => false);
		const capture = captureInfoLogs();
		try {
			await callTool(
				{
					name: 'buddy_graphql_mutate',
					arguments: {
						orgId: 'org-1',
						query: 'mutation UpdateThing { updateThing { id } }',
						scopeId: 'wf-1',
						scopeName: 'Workflow',
					},
				},
				settings({ enableDangerousGraphqlMutation: true, alwaysAllowedOrgs: ['org-1'] }),
			);
		} finally {
			capture.restore();
		}

		const lines = auditLines(capture.messages);
		assert.strictEqual(lines.length, 1);
		assert.ok(lines[0].includes('tool=buddy_graphql_mutate'));
		assert.ok(lines[0].includes('orgId=org-1'));
		assert.ok(lines[0].includes('outcome=approval_required'));
	});
});
