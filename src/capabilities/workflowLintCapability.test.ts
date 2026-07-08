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
			'query RewstBuddyMcpWorkflowLint',
			{
				query,
				variables,
			},
		);
	};
}

suite('Unit: workflowLintCapability', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('registered as a read capability with a derived schema', () => {
		const cap = getCapability('buddy_workflow_lint');
		assert.ok(cap, 'capability is registered');
		assert.strictEqual(cap.access, 'read');
		assert.strictEqual(cap.requiresOrg, undefined);
		assert.strictEqual(cap.scopedSessions, undefined);
		const schema = cap.spec.inputSchema as { required?: string[] };
		assert.deepStrictEqual(schema.required?.sort(), ['orgId', 'workflowId']);
		assert.strictEqual(cap.spec.args, JSON.stringify(cap.spec.inputSchema));
	});

	test('reports issues for a violating workflow', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflow: {
						id: 'wf-1',
						name: 'My Workflow',
						orgId: 'org-1',
						tasks: [
							{
								id: 'entry',
								name: 'entry',
								next: [{ when: '{{ SUCCEEDED }}', do: ['reachable'] }],
							},
							{
								id: 'reachable',
								name: 'reachable',
								isMocked: true,
							},
							{
								id: 'orphan',
								name: 'orphan task',
							},
						],
					},
				},
			},
		});
		const cap = getCapability('buddy_workflow_lint');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx);

		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1, 'exactly one rawGraphql call');
		const vars = (calls[0].variables as { variables?: { where?: { id?: string; orgId?: string } } })?.variables;
		assert.strictEqual(vars?.where?.id, 'wf-1', 'query passes workflowId');
		assert.strictEqual(vars?.where?.orgId, 'org-1', 'query passes orgId');
		assert.ok(output.includes('orphan task'), 'output mentions unreachable task name');
		assert.ok(output.includes('mock'), 'output mentions mock');
		assert.ok(output.length > 0, 'output is non-empty');
	});

	test('clean workflow → no issues message', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', {
			data: {
				data: {
					workflow: {
						id: 'wf-2',
						name: 'Clean Workflow',
						orgId: 'org-1',
						tasks: [
							{
								id: 'entry',
								name: 'START',
								next: [{ when: '{{ SUCCEEDED }}', do: ['done'] }],
							},
							{ id: 'done', name: 'done' },
						],
					},
				},
			},
		});
		const cap = getCapability('buddy_workflow_lint');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		const output = await cap.run({ orgId: 'org-1', workflowId: 'wf-2' }, ctx);
		assert.match(output, /No issues found/);
	});

	test('unknown workflow fails closed', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', { data: { data: { workflow: null } } });
		const cap = getCapability('buddy_workflow_lint');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1', workflowId: 'wf-missing' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('wf-missing'), 'error names workflowId');
				assert.ok(err.message.includes('org-1'), 'error names orgId');
				return true;
			},
		);
	});

	test('GraphQL errors propagate with context', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		wrapper.when('rawGraphql', { data: { data: undefined, errors: [{ message: 'boom' }] } });
		const cap = getCapability('buddy_workflow_lint');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1', workflowId: 'wf-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.toLowerCase().includes('graphql'), 'error mentions GraphQL');
				assert.ok(err.message.includes('boom'), 'error includes upstream message');
				return true;
			},
		);
	});

	test('missing orgId rejected, no GraphQL call', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const cap = getCapability('buddy_workflow_lint');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ workflowId: 'wf-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('orgId'), 'error names orgId');
				return true;
			},
		);
		assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 0, 'no GraphQL call made');
	});

	test('missing workflowId rejected, no GraphQL call', async () => {
		const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Acme' } } });
		useRawGraphqlWrapper(session, wrapper);
		const cap = getCapability('buddy_workflow_lint');
		assert.ok(cap);
		const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
		await assert.rejects(
			() => cap.run({ orgId: 'org-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('workflowId'), 'error names workflowId');
				return true;
			},
		);
		assert.strictEqual(wrapper.getCallsFor('rawGraphql').length, 0, 'no GraphQL call made');
	});
});
