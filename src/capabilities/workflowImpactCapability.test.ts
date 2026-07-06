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
			'query RewstBuddyMcpWorkflowImpact',
			{
				query,
				variables,
			},
		);
	};
}

suite('Unit: workflowImpactCapability', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('registered as a read capability with a derived schema', () => {
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap, 'buddy_workflow_impact is registered');
		assert.strictEqual(cap.access, 'read');
		assert.strictEqual(cap.requiresOrg, undefined, 'org-scoped default (requiresOrg not set)');
		const schema = cap.spec.inputSchema as {
			required: string[];
			properties: Record<string, unknown>;
		};
		assert.ok(schema.required.includes('orgId'), 'orgId is required');
		assert.ok('workflowId' in schema.properties, 'workflowId property exists');
		assert.ok('actions' in schema.properties, 'actions property exists');
		assert.strictEqual(cap.spec.args, JSON.stringify(cap.spec.inputSchema), 'args are generated from inputSchema');
	});

	test('workflowId mode lists callers deduped with task names', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflow: {
						id: 'wf-1',
						name: 'Child',
						orgId: 'org-1',
						parentWorkflows: [
							{
								name: 'call child',
								workflowId: 'wf-2',
								workflow: { id: 'wf-2', name: 'Caller A', orgId: 'org-1' },
							},
							{
								name: 'call child again',
								workflowId: 'wf-2',
								workflow: { id: 'wf-2', name: 'Caller A', orgId: 'org-1' },
							},
							{
								name: 'do child',
								workflowId: 'wf-3',
								workflow: { id: 'wf-3', name: 'Caller B', orgId: 'org-1' },
							},
						],
					},
				},
			},
		});
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(
			(calls[0].variables as { variables: { id: string } }).variables.id,
			'wf-1',
			'query passes workflowId as id variable',
		);
		assert.ok(
			(calls[0].variables as { query: string }).query.includes('parentWorkflows'),
			'query includes parentWorkflows',
		);
		assert.ok(output.includes('2 workflow'), 'output mentions 2 workflows');
		// Caller A appears once (deduped)
		const callerAMatches = output.match(/Caller A \(wf-2\)/g);
		assert.strictEqual(callerAMatches?.length, 1, 'Caller A appears exactly once (deduped)');
		assert.ok(output.includes('call child'), 'task name call child listed');
		assert.ok(output.includes('call child again'), 'task name call child again listed');
		assert.ok(output.includes('Caller B (wf-3)'), 'Caller B listed');
	});

	test('workflowId mode, no callers → plain statement', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflow: {
						id: 'wf-1',
						name: 'Child',
						orgId: 'org-1',
						parentWorkflows: [],
					},
				},
			},
		});
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx);
		assert.ok(output.includes('No workflows call'), 'output includes no-callers message');
		assert.ok(output.includes('Child'), 'output includes workflow name');
		assert.ok(output.includes('wf-1'), 'output includes workflow id');
		assert.ok(output.length > 0, 'output is non-empty');
	});

	test('org re-check fails closed when workflow is in a different org', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflow: {
						id: 'wf-1',
						name: 'Child',
						orgId: 'org-OTHER',
						parentWorkflows: [],
					},
				},
			},
		});
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('wf-1'), 'error names the workflow id');
				assert.ok(err.message.includes('org-1'), 'error names the org id');
				return true;
			},
		);
	});

	test('unknown workflow (null) fails closed', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflow: null,
				},
			},
		});
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('wf-1'), 'error names the workflow id');
				assert.ok(err.message.includes('org-1'), 'error names the org id');
				return true;
			},
		);
	});

	test('actions mode lists affected workflows', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowsAffectedByBreakingChanges: [
						{
							workflowId: 'wf-9',
							workflowName: 'Onboarding',
							affectedActionNames: ['create_user', 'licence_add'],
						},
					],
				},
			},
		});
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run(
			{ orgId: 'org-1', actions: [{ packRef: 'msgraph', actionRefs: ['create_user', 'licence_add'] }] },
			ctx,
		);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		const vars = (calls[0].variables as { variables: { orgId: string; actions: unknown[] } }).variables;
		assert.strictEqual(vars.orgId, 'org-1', 'orgId passed to query');
		assert.deepStrictEqual(
			vars.actions,
			[{ packRef: 'msgraph', actionRefs: ['create_user', 'licence_add'] }],
			'actions passed to query',
		);
		assert.ok(
			(calls[0].variables as { query: string }).query.includes('workflowsAffectedByBreakingChanges'),
			'query includes workflowsAffectedByBreakingChanges',
		);
		assert.ok(output.includes('Onboarding (wf-9)'), 'output includes workflow name and id');
		assert.ok(output.includes('create_user'), 'output includes affected action name');
		assert.ok(output.includes('licence_add'), 'output includes affected action name');
	});

	test('actions mode, empty response → plain statement', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflowsAffectedByBreakingChanges: [],
				},
			},
		});
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run(
			{ orgId: 'org-1', actions: [{ packRef: 'msgraph', actionRefs: ['create_user'] }] },
			ctx,
		);
		assert.ok(output.includes('No workflows'), 'output includes no-affected message');
		assert.ok(output.includes('org-1'), 'output includes org id');
		assert.ok(output.length > 0, 'output is non-empty');
	});

	test('neither mode → validation error, no GraphQL call', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1' }, ctx),
			(err: Error) => {
				assert.ok(
					err.message.includes('workflowId') && err.message.includes('actions'),
					'error names both fields',
				);
				return true;
			},
		);
		assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 0, 'no GraphQL call made');
	});

	test('both modes → validation error, no GraphQL call', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1', workflowId: 'wf-1', actions: [{ packRef: 'p', actionRefs: ['a'] }] }, ctx),
			(err: Error) => {
				assert.ok(
					err.message.includes('workflowId') && err.message.includes('actions'),
					'error names both fields',
				);
				return true;
			},
		);
		assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 0, 'no GraphQL call made');
	});

	test('malformed actions entries rejected', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		// Empty packRef and empty actionRefs
		await assert.rejects(() => cap.run({ orgId: 'org-1', actions: [{ packRef: '', actionRefs: [] }] }, ctx));
		// Empty actions array
		await assert.rejects(() => cap.run({ orgId: 'org-1', actions: [] }, ctx));
	});

	test('GraphQL errors propagate with context', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: undefined,
				errors: [{ message: 'boom' }],
			},
		});
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('GraphQL error'), 'error includes GraphQL error prefix');
				assert.ok(err.message.includes('boom'), 'error includes the error message');
				return true;
			},
		);
	});

	test('missing orgId rejected', async () => {
		const { session } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		const cap = getCapability('buddy_workflow_impact');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ workflowId: 'wf-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('Missing required string argument "orgId".'), 'error names orgId');
				return true;
			},
		);
	});
});
