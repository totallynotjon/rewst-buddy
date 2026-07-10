import type { Session } from '@sessions';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetApprovedMutationScopes, approveMutationScope, type MutationScope } from '../ui/chat/tools/graphqlTool';
import type { CapabilityContext } from './Capability';
import {
	_resetMcpMutationApproverForTesting,
	graphqlMutateCapability,
	setMcpMutationApprover,
} from './graphqlMutateCapability';

const { suite, test, setup, teardown } = Mocha;

function makeCtx(orgId = 'org-sandbox', orgName = 'Sandbox') {
	const calls: { query: string; variables?: Record<string, unknown> }[] = [];
	const session = {
		profile: { org: { id: orgId, name: orgName }, allManagedOrgs: [{ id: orgId, name: orgName }] },
		rawGraphql: async (query: string, variables?: Record<string, unknown>) => {
			calls.push({ query, variables });
			return { data: { deleteTemplate: { id: 't-1' } } };
		},
	} as unknown as Session;
	const ctx: CapabilityContext = { session, orgId, sessions: [session] };
	return { ctx, calls };
}

const DELETE_QUERY = 'mutation { deleteTemplate(id: "t-1") { id } }';

suite('Unit: graphqlMutateCapability', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	test('runs the mutation when approved', async () => {
		const { ctx, calls } = makeCtx();
		setMcpMutationApprover(async () => true);

		const output = await graphqlMutateCapability.run(
			{ orgId: 'org-sandbox', query: DELETE_QUERY, scopeId: 't-1', scopeName: 'Doomed' },
			ctx,
		);

		assert.strictEqual(calls.length, 1);
		assert.match(output, /deleteTemplate/);
	});

	test('does not run when approval is denied', async () => {
		const { ctx, calls } = makeCtx();
		setMcpMutationApprover(async () => false);

		const output = await graphqlMutateCapability.run(
			{ orgId: 'org-sandbox', query: DELETE_QUERY, scopeId: 't-1', scopeName: 'Doomed' },
			ctx,
		);

		assert.strictEqual(calls.length, 0);
		assert.strictEqual(JSON.parse(output).status, 'approval_required');
	});

	test('always prompts, even when the scope was approved by an earlier mutation on the same resource (#177 gap)', async () => {
		const { ctx, calls } = makeCtx();
		// buddy_graphql_mutate lets the caller supply any scopeId for any query, so
		// unlike the typed capabilities (where scopeId is verified against a
		// fetched resource), reusing a scope-keyed approval here is unsound: a
		// prior approval for a rename/update on this resource must not silently
		// authorize an arbitrary later mutation (e.g. a delete) with the same
		// scopeId.
		const priorScope: MutationScope = {
			scopeId: 't-1',
			scopeName: 'Doomed',
			orgId: 'org-sandbox',
			orgName: 'Sandbox',
		};
		approveMutationScope(priorScope);

		let approverCalled = false;
		setMcpMutationApprover(async () => {
			approverCalled = true;
			return true;
		});

		await graphqlMutateCapability.run(
			{ orgId: 'org-sandbox', query: DELETE_QUERY, scopeId: 't-1', scopeName: 'Doomed' },
			ctx,
		);

		assert.ok(approverCalled, 'buddy_graphql_mutate must always prompt, never reuse a cached scope approval');
		assert.strictEqual(calls.length, 1);
	});

	test('does not run when denied, even if the scope was approved by an earlier mutation (#177)', async () => {
		const { ctx, calls } = makeCtx();
		const priorScope: MutationScope = {
			scopeId: 't-1',
			scopeName: 'Doomed',
			orgId: 'org-sandbox',
			orgName: 'Sandbox',
		};
		approveMutationScope(priorScope);
		setMcpMutationApprover(async () => false);

		const output = await graphqlMutateCapability.run(
			{ orgId: 'org-sandbox', query: DELETE_QUERY, scopeId: 't-1', scopeName: 'Doomed' },
			ctx,
		);

		assert.strictEqual(calls.length, 0);
		assert.strictEqual(JSON.parse(output).status, 'approval_required');
	});

	test('rejects a query operation', async () => {
		const { ctx } = makeCtx();
		setMcpMutationApprover(async () => true);
		await assert.rejects(
			() =>
				graphqlMutateCapability.run(
					{ orgId: 'org-sandbox', query: 'query { templates { id } }', scopeId: 't-1', scopeName: 'X' },
					ctx,
				),
			/runs mutations only/,
		);
	});
});
