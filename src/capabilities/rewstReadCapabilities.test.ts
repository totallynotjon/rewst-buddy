import type { Session } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { CapabilityContext } from './Capability';
import { getCapability } from './registry';

const { suite, test, setup } = Mocha;

function useRawGraphqlWrapper(session: Session, wrapper: ReturnType<typeof createMockSession>['wrapper']): void {
	const wrap = wrapper.getWrapper();
	(session as { rawGraphql: Session['rawGraphql'] }).rawGraphql = async (query, variables) => {
		return wrap(
			async () => ({ data: undefined, errors: undefined }),
			'rawGraphql',
			'query RewstBuddyMcpWorkflows',
			{
				query,
				variables,
			},
		);
	};
}

suite('Unit: rewstReadCapabilities', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('buddy_list_workflows uses workflows query, maps name search, and parses workflows results', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflows: [
						{
							id: 'wf-1',
							name: 'Foo workflow',
							description: 'Found by search',
						},
					],
				},
			},
		});
		const listWorkflows = getCapability('buddy_list_workflows');
		assert.ok(listWorkflows, 'buddy_list_workflows is registered');

		const output = await listWorkflows.run({ orgId: 'org-1', search: 'foo', limit: 25 }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('workflows('), 'query uses workflows');
		assert.ok(!calls[0].variables.query.includes('visibleWorkflows'), 'query does not use visibleWorkflows');
		assert.deepStrictEqual(calls[0].variables.variables.search, { name: { _ilike: '%foo%' } });
		assert.ok(output.includes('Foo workflow (wf-1) — Found by search'));
	});

	test('buddy_list_org_variables uses masked orgVariables query, maps name search, and formats variables', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					orgVariables: [
						{
							name: 'api_key',
							value: '********',
							category: 'secret',
							cascade: true,
						},
					],
				},
			},
		});
		const listOrgVariables = getCapability('buddy_list_org_variables');
		assert.ok(listOrgVariables, 'buddy_list_org_variables is registered');

		const output = await listOrgVariables.run({ orgId: 'org-1', search: 'term', limit: 10 }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('orgVariables('), 'query uses orgVariables');
		assert.ok(calls[0].variables.query.includes('maskSecrets: true'), 'query masks secrets');
		assert.deepStrictEqual(calls[0].variables.variables.search, { name: { _ilike: '%term%' } });
		assert.ok(output.includes('api_key = ********  [secret, cascade]'));
	});

	test('buddy_find_action flattens pack actions, caps output, falls back to name, and includes pack names', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					searchInstalledPackActions: [
						{
							id: 'pack-1',
							name: 'Core Pack',
							ref: 'core',
							actions: [
								{
									id: 'action-1',
									name: 'Create Ticket',
									ref: null,
									description: 'Open a ticket',
								},
								{
									id: 'action-2',
									name: 'Update Ticket',
									ref: 'ticket_update',
									description: 'Update a ticket',
								},
							],
						},
						{
							id: 'pack-2',
							name: 'Automation Pack',
							ref: 'automation',
							actions: [
								{
									id: 'action-3',
									name: 'Close Ticket',
									ref: 'ticket_close',
									description: 'Close a ticket',
								},
							],
						},
					],
				},
			},
		});
		const findAction = getCapability('buddy_find_action');
		assert.ok(findAction, 'buddy_find_action is registered');

		const output = await findAction.run({ orgId: 'org-1', filter: 'ticket', limit: 2 }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const lines = output.split('\n');
		assert.strictEqual(lines.length, 3);
		assert.strictEqual(lines[0], 'Create Ticket (action-1) — Core Pack: Open a ticket');
		assert.strictEqual(lines[1], 'ticket_update (action-2) — Core Pack: Update a ticket');
		assert.strictEqual(lines[2], '…(1 more not shown; refine the filter)');
		assert.ok(output.includes('Core Pack'), 'pack name is included in output');
		assert.ok(!output.includes('ticket_close (action-3)'), 'output is capped to the requested limit');
	});

	test('buddy_resolve_reference uses localReferenceOptions query, forwards model and search, and formats options', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					localReferenceOptions: [
						{
							label: 'Foo workflow',
							value: 'wf-1',
						},
					],
				},
			},
		});
		const resolveReference = getCapability('buddy_resolve_reference');
		assert.ok(resolveReference, 'buddy_resolve_reference is registered');

		const output = await resolveReference.run({ orgId: 'org-1', modelType: 'Workflow', search: 'foo', limit: 25 }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('localReferenceOptions('), 'query uses localReferenceOptions');
		assert.strictEqual(calls[0].variables.variables.modelName, 'Workflow');
		assert.strictEqual(calls[0].variables.variables.search, 'foo');
		assert.strictEqual(output, 'Foo workflow (wf-1)');
	});

	test('buddy_resolve_reference rejects invalid model types', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const resolveReference = getCapability('buddy_resolve_reference');
		assert.ok(resolveReference, 'buddy_resolve_reference is registered');

		await assert.rejects(
			() =>
				resolveReference.run({ orgId: 'org-1', modelType: 'Widget' }, {
					session,
					orgId: 'org-1',
					sessions: [session],
				} satisfies CapabilityContext),
			/Invalid modelType "Widget". Valid modelType values: Crate, CustomDatabase, Organization, PackConfig, Role, Template, TemplateExport, User, Workflow, Trigger, Form, Site, Page/,
		);
	});

	test('buddy_list_workflow_executions uses workflowExecutions query, maps status search, and formats executions', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowExecutions: [
						{
							id: 'exec-1',
							status: 'succeeded',
							createdAt: '1735689600000',
							workflow: { id: 'wf-1' },
							numSuccessfulTasks: 4,
						},
					],
				},
			},
		});
		const listWorkflowExecutions = getCapability('buddy_list_workflow_executions');
		assert.ok(listWorkflowExecutions, 'buddy_list_workflow_executions is registered');

		const output = await listWorkflowExecutions.run({ orgId: 'org-1', status: 'succeeded', limit: 10 }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('workflowExecutions('), 'query uses workflowExecutions');
		assert.ok(calls[0].variables.query.includes('workflow {'), 'query requests nested workflow id');
		assert.deepStrictEqual(calls[0].variables.variables.search, { status: { _eq: 'succeeded' } });
		assert.ok(output.includes('succeeded — exec-1 (workflow wf-1, 4 ok, created 1735689600000)'));
	});

	test('buddy_find_executions_by_variable scans conductor input and matches name and value', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowExecutions: [
						{
							id: 'exec-1',
							status: 'succeeded',
							createdAt: '1700000000000',
							conductor: { input: { timezone: 'UTC', requestor: 'alice' }, output: {} },
						},
						{
							id: 'exec-2',
							status: 'failed',
							createdAt: '1700000001000',
							conductor: { input: { timezone: 'PST' }, output: {} },
						},
					],
				},
			},
		});
		const findExec = getCapability('buddy_find_executions_by_variable');
		assert.ok(findExec, 'buddy_find_executions_by_variable is registered');

		const ctx = { session, orgId: 'org-1', sessions: [session] } satisfies CapabilityContext;

		const byName = await findExec.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'timezone', kind: 'input' }, ctx);
		const calls = wrapper.getCallsFor('rawGraphql');
		assert.ok(calls[0].variables.query.includes('conductor'), 'bulk query selects conductor');
		assert.ok(calls[0].variables.variables.workflowId === 'wf-1', 'scopes to the workflow');
		assert.ok(byName.includes('exec-1') && byName.includes('timezone=UTC'), 'matches and shows the variable value');
		assert.ok(byName.includes('exec-2'), 'matches both executions by name');

		const byValue = await findExec.run(
			{ orgId: 'org-1', workflowId: 'wf-1', name: 'timezone', kind: 'input', value: 'utc' },
			ctx,
		);
		assert.ok(byValue.includes('exec-1') && !byValue.includes('exec-2'), 'value filter narrows to UTC run');

		const noMatch = await findExec.run(
			{ orgId: 'org-1', workflowId: 'wf-1', name: 'nonexistent', kind: 'input' },
			ctx,
		);
		assert.ok(noMatch.startsWith('No executions'), 'reports no match');
	});

	test('buddy_find_executions_by_variable scans execution contexts and reports skipped failed fetches', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when(
			'rawGraphql',
			(arg: {
				query: string;
				variables: Record<string, unknown>;
			}): { data?: { data: Record<string, unknown> }; error?: Error } => {
				if (arg.query.includes('workflowExecutionContexts')) {
					const id = arg.variables.workflowExecutionId;
					if (id === 'exec-1') {
						return {
							data: { data: { workflowExecutionContexts: [{ ticket_id: '12345' }, { stage: 'done' }] } },
						};
					}
					if (id === 'exec-2') {
						return { data: { data: { workflowExecutionContexts: [{ unrelated: 'x' }] } } };
					}
					return { error: new Error('context fetch failed') };
				}
				return {
					data: {
						data: {
							workflowExecutions: [
								{
									id: 'exec-1',
									status: 'succeeded',
									createdAt: '1700000000000',
									conductor: { input: {}, output: {} },
								},
								{
									id: 'exec-2',
									status: 'succeeded',
									createdAt: '1700000001000',
									conductor: { input: {}, output: {} },
								},
								{
									id: 'exec-3',
									status: 'failed',
									createdAt: '1700000002000',
									conductor: { input: {}, output: {} },
								},
							],
						},
					},
				};
			},
		);
		const findExec = getCapability('buddy_find_executions_by_variable');
		assert.ok(findExec, 'buddy_find_executions_by_variable is registered');
		const ctx = { session, orgId: 'org-1', sessions: [session] } satisfies CapabilityContext;

		const out = await findExec.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'ticket', kind: 'context' }, ctx);

		assert.ok(out.includes('exec-1') && out.includes('ticket_id=12345'), 'matches a context variable');
		assert.ok(!out.includes('exec-2'), 'omits executions whose context does not match');
		assert.ok(/1 execution context fetch/.test(out), 'reports the failed context fetch as skipped');

		const contextCalls = wrapper
			.getCallsFor('rawGraphql')
			.filter(c => c.variables.query.includes('workflowExecutionContexts'));
		assert.strictEqual(contextCalls.length, 3, 'issues one context fetch per scanned execution');
	});

	test('buddy_find_executions_by_variable counts an errors-carrying context response as skipped, not fatal', async () => {
		// Pins residual 4: the inline `if (res.errors)` check must be replaced with
		// throwOnGraphqlErrors (or rawGraphqlOrThrow) so an errors-carrying response
		// throws inside the per-execution try/catch and is counted as skipped rather
		// than silently treated as empty data or made fatal to the whole tool call.
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', (arg: { query: string; variables: Record<string, unknown> }): { data?: unknown } => {
			if (arg.query.includes('workflowExecutionContexts')) {
				// The MockWrapper returns response.data as the rawGraphql result, so the
				// { data, errors } envelope that rawGraphql returns must be nested inside
				// the outer `data` field here.
				const id = arg.variables.workflowExecutionId;
				if (id === 'exec-1') {
					return {
						data: { data: { workflowExecutionContexts: [{ ticket_id: '12345' }, { stage: 'done' }] } },
					};
				}
				if (id === 'exec-2') {
					return { data: { data: { workflowExecutionContexts: [{ unrelated: 'x' }] } } };
				}
				return { data: { data: undefined, errors: [{ message: 'boom' }] } };
			}
			return {
				data: {
					data: {
						workflowExecutions: [
							{
								id: 'exec-1',
								status: 'succeeded',
								createdAt: '1700000000000',
								conductor: { input: {}, output: {} },
							},
							{
								id: 'exec-2',
								status: 'succeeded',
								createdAt: '1700000001000',
								conductor: { input: {}, output: {} },
							},
							{
								id: 'exec-3',
								status: 'failed',
								createdAt: '1700000002000',
								conductor: { input: {}, output: {} },
							},
						],
					},
				},
			};
		});
		const findExec = getCapability('buddy_find_executions_by_variable');
		assert.ok(findExec, 'buddy_find_executions_by_variable is registered');
		const ctx = { session, orgId: 'org-1', sessions: [session] } satisfies CapabilityContext;

		// Must resolve (not reject) — the errors-carrying response is caught per-execution.
		const out = await findExec.run({ orgId: 'org-1', workflowId: 'wf-1', name: 'ticket', kind: 'context' }, ctx);

		assert.ok(out.includes('exec-1') && out.includes('ticket_id=12345'), 'matches a context variable');
		assert.ok(/1 execution context fetch/.test(out), `expected skip note, got: ${out}`);
	});

	test('buddy_latest_workflow_execution uses latestWorkflowExecution query, forwards workflowId, and handles missing execution', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					latestWorkflowExecution: null,
				},
			},
		});
		const latestWorkflowExecution = getCapability('buddy_latest_workflow_execution');
		assert.ok(latestWorkflowExecution, 'buddy_latest_workflow_execution is registered');

		const output = await latestWorkflowExecution.run({ orgId: 'org-1', workflowId: 'wf-1' }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('latestWorkflowExecution('), 'query uses latestWorkflowExecution');
		assert.strictEqual(calls[0].variables.variables.workflowId, 'wf-1');
		assert.ok(output.includes('No execution found for workflow wf-1'));
	});

	test('buddy_get_workflow_execution_stats uses workflowExecutionStats query, forwards createdSince, and formats stats', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowExecutionStats: {
						succeeded: 11,
						failed: 2,
						running: 3,
						pending: 5,
						paused: 7,
						delayed: 13,
						humanSecondsSaved: 610,
					},
				},
			},
		});
		const getWorkflowExecutionStats = getCapability('buddy_get_workflow_execution_stats');
		assert.ok(getWorkflowExecutionStats, 'buddy_get_workflow_execution_stats is registered');

		const output = await getWorkflowExecutionStats.run({ orgId: 'org-1', createdSince: '2025-01-01T00:00:00Z' }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('workflowExecutionStats('), 'query uses workflowExecutionStats');
		assert.strictEqual(calls[0].variables.variables.createdSince, '2025-01-01T00:00:00Z');
		assert.strictEqual(
			output,
			[
				'succeeded: 11',
				'failed: 2',
				'running: 3',
				'pending: 5',
				'paused: 7',
				'delayed: 13',
				'humanSecondsSaved: 610',
			].join('\n'),
		);
	});

	test('buddy_list_workflow_tasks uses workflowTasks query, forwards workflowId, and formats tasks', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowTasks: [
						{
							id: 'abc123def456',
							name: 'Create ticket',
							actionId: 'action-1',
							workflowId: 'wf-1',
							isMocked: false,
							timeout: 120,
							description: 'Open a ticket',
						},
						{
							id: 'fed456cba123',
							name: 'Notify team',
							actionId: null,
							workflowId: 'wf-1',
							isMocked: false,
							timeout: null,
							description: null,
						},
					],
				},
			},
		});
		const listWorkflowTasks = getCapability('buddy_list_workflow_tasks');
		assert.ok(listWorkflowTasks, 'buddy_list_workflow_tasks is registered');

		const output = await listWorkflowTasks.run({ orgId: 'org-1', workflowId: 'wf-1', limit: 10 }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('workflowTasks('), 'query uses workflowTasks');
		assert.strictEqual(calls[0].variables.variables.workflowId, 'wf-1');
		assert.strictEqual(calls[0].variables.variables.limit, 10);
		assert.strictEqual(
			output,
			[
				'Create ticket (abc123def456) — action action-1 — timeout 120 — Open a ticket',
				'Notify team (fed456cba123)',
			].join('\n'),
		);
	});

	test('buddy_list_workflow_tasks marks only mocked tasks in the simple list', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowTasks: [
						{
							id: 'abc123def456',
							name: 'Create ticket',
							actionId: 'action-1',
							workflowId: 'wf-1',
							isMocked: true,
							timeout: 120,
							description: 'Open a ticket',
						},
						{
							id: 'fed456cba123',
							name: 'Notify team',
							actionId: 'action-2',
							workflowId: 'wf-1',
							isMocked: false,
							timeout: null,
							description: null,
						},
					],
				},
			},
		});
		const listWorkflowTasks = getCapability('buddy_list_workflow_tasks');
		assert.ok(listWorkflowTasks, 'buddy_list_workflow_tasks is registered');

		const output = await listWorkflowTasks.run({ orgId: 'org-1', workflowId: 'wf-1' }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		assert.strictEqual(
			output,
			[
				'Create ticket (abc123def456) — action action-1 [mocked] — timeout 120 — Open a ticket',
				'Notify team (fed456cba123) — action action-2',
			].join('\n'),
		);
		assert.ok(!output.includes('isMocked:false'), 'normal tasks do not get a noisy false marker');
	});

	test('buddy_list_workflow_tasks description documents the conditional mocked marker', () => {
		const listWorkflowTasks = getCapability('buddy_list_workflow_tasks');
		assert.ok(listWorkflowTasks, 'buddy_list_workflow_tasks is registered');

		assert.ok(
			listWorkflowTasks.spec.description.includes('mocked marker only when a task is mocked'),
			'tool description explains that mocked output is conditional',
		);
		assert.ok(
			!listWorkflowTasks.spec.description.includes('isMocked,'),
			'description does not imply isMocked is always listed',
		);
	});

	test('buddy_list_workflow_patches uses workflowPatches query, forwards workflowId, and formats patches', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowPatches: [
						{
							id: 'patch-1',
							patchType: 'update',
							comment: 'Rename task',
							commentDescription: 'Task name cleanup',
							workflowId: 'wf-1',
							createdAt: '1735689600000',
						},
						{
							id: 'patch-2',
							patchType: 'create',
							comment: null,
							commentDescription: null,
							workflowId: 'wf-1',
							createdAt: '1735603200000',
						},
					],
				},
			},
		});
		const listWorkflowPatches = getCapability('buddy_list_workflow_patches');
		assert.ok(listWorkflowPatches, 'buddy_list_workflow_patches is registered');

		const output = await listWorkflowPatches.run({ orgId: 'org-1', workflowId: 'wf-1', limit: 5 }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('workflowPatches('), 'query uses workflowPatches');
		assert.ok(calls[0].variables.query.includes('orderBy: createdAt_DESC'), 'query sorts patches newest first');
		assert.strictEqual(calls[0].variables.variables.workflowId, 'wf-1');
		assert.strictEqual(calls[0].variables.variables.limit, 5);
		assert.strictEqual(
			output,
			['update — patch-1: Rename task (created 1735689600000)', 'create — patch-2 (created 1735603200000)'].join(
				'\n',
			),
		);
	});

	test('buddy_get_workflow_patch uses workflowPatch query, forwards id, and serializes the patch JSON', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const workflowPatch = {
			id: 'patch-1',
			patchType: 'update',
			patch: [
				{
					op: 'replace',
					path: '/tasks/abc123def456/name',
					value: 'Create ticket',
				},
			],
			comment: 'Rename task',
			commentDescription: 'Task name cleanup',
			workflowId: 'wf-1',
			createdAt: '1735689600000',
		};
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowPatch,
				},
			},
		});
		const getWorkflowPatch = getCapability('buddy_get_workflow_patch');
		assert.ok(getWorkflowPatch, 'buddy_get_workflow_patch is registered');

		const output = await getWorkflowPatch.run({ orgId: 'org-1', patchId: 'patch-1' }, {
			session,
			orgId: 'org-1',
			sessions: [session],
		} satisfies CapabilityContext);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].variables.query.includes('workflowPatch(id: $id)'), 'query uses workflowPatch by id');
		assert.strictEqual(calls[0].variables.variables.id, 'patch-1');
		assert.deepStrictEqual(JSON.parse(output), workflowPatch);
		assert.strictEqual(output, JSON.stringify(workflowPatch, null, 2));
	});
});
