import {
	_resetMcpMutationApproverForTesting,
	getCapability,
	setMcpMutationApprover,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import type { Session } from '@sessions';
import { clearCachedSession, getTestOrgId, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import { runWorkflowTool } from '@workflow';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { rawGraphqlOrThrow } from '../../capabilities/inputHelpers';
import { _resetApprovedMutationScopes, type GraphqlToolDeps } from '../../ui/chat/tools/graphqlTool';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = getCapability(name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

interface WorkflowSummary {
	workflow: {
		id: string;
		name: string;
		orgId: string;
		orgName?: string;
		inputs?: { name: string; type: string; required?: boolean }[];
		outputs?: { name: string; value: unknown }[];
	};
	nodes: { id?: string; name: string; action: string; position?: { x: number; y: number } }[];
	edges: { from: string; to: string[] }[];
}

const WORKFLOW_BY_ID = `query RbItestSandboxWorkflowTree($id: ID!) {
  workflow(where: { id: $id }) {
    id name description orgId input output
    tasks { id name description timeout publishResultAs metadata input }
  }
}`;

const DELETE_WORKFLOW = `mutation RbItestDeleteSandboxWorkflowTree($id: ID!) { deleteWorkflow(id: $id) }`;

suite('Integration: disposable sandbox workflow tree', function () {
	this.timeout(180_000);

	let session: Session;
	let ctx: CapabilityContext;
	let deps: GraphqlToolDeps;
	let orgId: string;
	let workflowId: string;
	let workflowName: string;

	suiteSetup(async function () {
		if (!writeTestsEnabled()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		orgId = getTestOrgId();
		session = await getTestSession();
		if (session.profile.org.id !== orgId || session.profile.allManagedOrgs.some(org => org.id !== orgId)) {
			throw new Error('Safety invariant failed: workflow fixture session is not sandbox-only.');
		}
		ctx = { session, orgId, sessions: [session] };
		deps = {
			isEnabled: () => true,
			confirmMutation: async () => true,
			execute: (query, variables) => session.rawGraphql(query, variables),
			cacheScope: `integration:${orgId}`,
		};
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		setMcpMutationApprover(async () => true);

		workflowName = `[RB ITEST] sandbox tree ${Date.now()}`;
		const created = JSON.parse(
			await cap('buddy_create_workflow').run(
				{ orgId, name: workflowName, description: 'Disposable integration workflow tree' },
				ctx,
			),
		);
		workflowId = created.id;
		assert.ok(workflowId, 'fixture workflow was created');

		await runWorkflowTool(
			{
				tool: 'buddy_workflow_edit',
				args: {
					workflowId,
					workflowName,
					orgId,
					orgName: session.profile.org.name,
					comment: '[RB ITEST] build sandbox workflow tree',
					operations: [
						{ op: 'add_task', name: 'START', action: 'core.noop', description: 'Entry anchor' },
						{
							op: 'add_task',
							name: 'Transform',
							action: 'core.noop',
							description: 'Sandbox transform',
							input: { message: '{{ CTX.message }}' },
							publishResultAs: 'transform_result',
							timeout: 60,
						},
						{ op: 'connect', from: 'START', to: 'Transform' },
						{
							op: 'set_inputs',
							inputs: [
								{
									name: 'message',
									type: 'string',
									title: 'Message',
									required: true,
									description: 'Sandbox input',
								},
							],
						},
						{ op: 'set_output', outputs: { echoed_message: '{{ CTX.message }}' } },
					],
				},
			},
			deps,
		);
	});

	suiteTeardown(async () => {
		if (session && workflowId) {
			try {
				await session.rawGraphql(DELETE_WORKFLOW, { id: workflowId });
			} catch (error) {
				console.warn(`[itest] failed to clean sandbox workflow ${workflowId}: ${String(error)}`);
			}
		}
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		clearCachedSession();
	});

	test('the raw workflow fixture belongs to the configured sandbox and keeps its description', async () => {
		const data = (await rawGraphqlOrThrow(session, WORKFLOW_BY_ID, { id: workflowId })) as {
			workflow?: { id: string; orgId: string; description?: string; tasks?: unknown[] };
		};
		assert.strictEqual(data.workflow?.id, workflowId);
		assert.strictEqual(data.workflow?.orgId, orgId);
		assert.strictEqual(data.workflow?.description, 'Disposable integration workflow tree');
		assert.strictEqual(data.workflow?.tasks?.length, 2);
	});

	test('buddy_workflow_get exposes the START-to-Transform graph and call contract', async () => {
		const summary = JSON.parse(
			await runWorkflowTool({ tool: 'buddy_workflow_get', args: { orgId, workflowId } }, deps),
		) as WorkflowSummary;
		assert.strictEqual(summary.workflow.orgId, orgId);
		assert.deepStrictEqual(summary.nodes.map(node => node.name).sort(), ['START', 'Transform']);
		assert.ok(summary.edges.some(edge => edge.from === 'START' && edge.to.includes('Transform')));
		assert.deepStrictEqual(
			summary.workflow.inputs?.map(input => input.name),
			['message'],
		);
		assert.deepStrictEqual(summary.workflow.outputs, [{ name: 'echoed_message', value: '{{ CTX.message }}' }]);
	});

	test('buddy_list_workflow_tasks reads both fixture children with execution settings', async () => {
		const output = await cap('buddy_list_workflow_tasks').run({ orgId, workflowId, limit: 10 }, ctx);
		assert.match(output, /START \(/);
		assert.match(output, /Transform \(/);
		assert.match(output, /timeout 60/);
		assert.match(output, /Sandbox transform/);
	});

	test('buddy_workflow_lint recognizes the START anchor and produces a structured live report', async () => {
		const output = await cap('buddy_workflow_lint').run({ orgId, workflowId }, ctx);
		assert.ok(output.includes(workflowId), output);
		assert.doesNotMatch(output, /missing-start-anchor/);
		assert.ok(/No issues found|issue\(s\)/.test(output), output);
	});

	test('buddy_list_workflow_patches sees the fixture build patch', async () => {
		const output = await cap('buddy_list_workflow_patches').run({ orgId, workflowId, limit: 10 }, ctx);
		assert.match(output, /\[RB ITEST\] build sandbox workflow tree|Edited by Cage-Free Rewsty/);
	});

	test('buddy_render_jinja evaluates sandbox fixture expressions with explicit vars', async () => {
		const output = await runWorkflowTool(
			{
				tool: 'buddy_render_jinja',
				args: { orgId, template: '{{ message }} / {{ count + 1 }}', vars: { message: 'sandbox', count: 2 } },
			},
			deps,
		);
		assert.match(output, /Rendered: sandbox \/ 3/);
	});

	test('buddy_workflow_impact reports the disposable tree has no external callers', async () => {
		const output = await cap('buddy_workflow_impact').run({ orgId, workflowId }, ctx);
		assert.match(output, /No workflows call|workflow\(s\) call/);
	});

	test('buddy_workflow_edit updates one child without changing the tree contract', async () => {
		await runWorkflowTool(
			{
				tool: 'buddy_workflow_edit',
				args: {
					workflowId,
					workflowName,
					orgId,
					orgName: session.profile.org.name,
					comment: '[RB ITEST] update sandbox workflow child',
					operations: [
						{
							op: 'update_task',
							name: 'Transform',
							set: { description: 'Updated sandbox transform', timeout: 90 },
						},
					],
				},
			},
			deps,
		);
		const data = (await rawGraphqlOrThrow(session, WORKFLOW_BY_ID, { id: workflowId })) as {
			workflow?: { orgId: string; tasks?: { name: string; description?: string; timeout?: number }[] };
		};
		const transform = data.workflow?.tasks?.find(task => task.name === 'Transform');
		assert.strictEqual(data.workflow?.orgId, orgId);
		assert.strictEqual(transform?.description, 'Updated sandbox transform');
		assert.strictEqual(transform?.timeout, 90);
		assert.strictEqual(data.workflow?.tasks?.length, 2);
	});

	test('buddy_workflow_autolayout writes finite positions for every fixture task', async () => {
		await runWorkflowTool(
			{
				tool: 'buddy_workflow_autolayout',
				args: { workflowId, workflowName, orgId, orgName: session.profile.org.name },
			},
			deps,
		);
		const summary = JSON.parse(
			await runWorkflowTool({ tool: 'buddy_workflow_get', args: { orgId, workflowId, detail: 'full' } }, deps),
		) as WorkflowSummary;
		for (const node of summary.nodes) {
			assert.ok(Number.isFinite(node.position?.x), `${node.name} x`);
			assert.ok(Number.isFinite(node.position?.y), `${node.name} y`);
		}
	});
});
