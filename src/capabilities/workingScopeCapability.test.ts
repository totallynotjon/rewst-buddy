import * as assert from 'assert';
import * as Mocha from 'mocha';
import { WorkingScopeManager } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import type { Session } from '@sessions';
import type { CapabilityContext } from './Capability';
import {
	_resetWorkingScopeApproverForTesting,
	getWorkingScopeCapability,
	setWorkingScopeApprover,
	setWorkingScopeCapability,
	workingScopeApprovalText,
	type NamedWorkflow,
} from './workingScopeCapability';

const { suite, test, setup, teardown } = Mocha;

function ctxFor(orgId = 'org-1', orgName = 'Acme'): CapabilityContext {
	const { session } = createMockSession({ profile: { org: { id: orgId, name: orgName } } });
	SessionManager._setSessionsForTesting([session]);
	return { session, orgId, sessions: SessionManager.getActiveSessions() };
}

/** Returns a ctx whose sessions resolve workflow ids via rawGraphql. */
function ctxWithWorkflowResolver(workflows: NamedWorkflow[], orgId = 'org-1'): CapabilityContext {
	// Build a queue of responses: one per workflow id, in order.
	const queue = workflows.map(wf => ({
		data: { workflow: { id: wf.id, name: wf.name, orgId: wf.orgId ?? orgId } },
	}));
	let callIndex = 0;
	const session = {
		rawGraphql: async (_query: string, _vars?: Record<string, unknown>) => {
			return queue[callIndex++] ?? { data: { workflow: null } };
		},
		profile: { org: { id: orgId, name: 'Acme' }, allManagedOrgs: [{ id: orgId, name: 'Acme' }] },
	} as unknown as Session;
	SessionManager._setSessionsForTesting([session]);
	return { session, orgId, sessions: [session] };
}

suite('Unit: workingScopeCapability', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
		_resetWorkingScopeApproverForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
		_resetWorkingScopeApproverForTesting();
	});

	test('buddy_get_working_scope reports the current scope', async () => {
		const ctx = ctxFor();
		WorkingScopeManager.setOrgs(['org-1']);
		WorkingScopeManager.setWorkflows(['wf-1']);

		const parsed = JSON.parse(await getWorkingScopeCapability.run({}, ctx)) as {
			orgs: string[];
			workflows: string[];
			scopeMode: string;
		};

		assert.deepStrictEqual(parsed.orgs, ['org-1']);
		assert.deepStrictEqual(parsed.workflows, ['wf-1']);
		assert.strictEqual(parsed.scopeMode, 'strict');
	});

	test('buddy_set_working_scope requires at least one org or workflow', async () => {
		const ctx = ctxFor();
		await assert.rejects(setWorkingScopeCapability.run({}, ctx), /at least one/i);
	});

	test('buddy_set_working_scope rejects an org no session manages', async () => {
		const ctx = ctxFor('org-1');
		setWorkingScopeApprover(async () => true);
		await assert.rejects(setWorkingScopeCapability.run({ orgs: ['org-999'] }, ctx), /org-999/);
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), []);
	});

	test('buddy_set_working_scope returns denied when the user declines all approvals', async () => {
		const ctx = ctxFor('org-1');
		setWorkingScopeApprover(async () => false);

		const parsed = JSON.parse(await setWorkingScopeCapability.run({ orgs: ['org-1'] }, ctx)) as {
			status: string;
		};

		assert.strictEqual(parsed.status, 'denied');
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), []);
	});

	test('buddy_set_working_scope adds to the scope after approval (workflow-only, no resolver needed)', async () => {
		const ctx = ctxFor('org-1');
		WorkingScopeManager.setOrgs(['org-existing']);
		setWorkingScopeApprover(async () => true);

		// Workflow-only: no GraphQL resolution needed when no workflow ids are passed.
		const parsed = JSON.parse(await setWorkingScopeCapability.run({ orgs: ['org-1'] }, ctx)) as {
			status: string;
			scope: { orgs: string[]; workflows: string[] };
		};

		assert.strictEqual(parsed.status, 'ok');
		assert.deepStrictEqual(parsed.scope.orgs.sort(), ['org-1', 'org-existing']);
	});

	test('buddy_set_working_scope replaces the named dimension when replace is true', async () => {
		const ctx = ctxFor('org-1');
		WorkingScopeManager.setOrgs(['org-existing']);
		WorkingScopeManager.setWorkflows(['wf-keep']);
		setWorkingScopeApprover(async () => true);

		await setWorkingScopeCapability.run({ orgs: ['org-1'], replace: true }, ctx);

		// orgs replaced, workflows untouched (not named in the call).
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1']);
		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), ['wf-keep']);
	});

	test('buddy_set_working_scope resolves workflow names and adds them after approval', async () => {
		const ctx = ctxWithWorkflowResolver([{ id: 'wf-1', name: 'My Workflow' }]);
		WorkingScopeManager.setWorkflows(['wf-existing']);
		setWorkingScopeApprover(async () => true);

		const parsed = JSON.parse(await setWorkingScopeCapability.run({ workflows: ['wf-1'] }, ctx)) as {
			status: string;
			scope: { orgs: string[]; workflows: string[] };
		};

		assert.strictEqual(parsed.status, 'ok');
		assert.ok(parsed.scope.workflows.includes('wf-1'));
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), [], 'org scope is untouched by a workflow-only call');
		// Name should be stored in the manager.
		assert.strictEqual(WorkingScopeManager.workflowNames.get('wf-1'), 'My Workflow');
	});

	test('buddy_set_working_scope replaces workflows-only when replace is true', async () => {
		const ctx = ctxWithWorkflowResolver([{ id: 'wf-1', name: 'My Workflow' }]);
		WorkingScopeManager.setWorkflows(['wf-existing']);
		setWorkingScopeApprover(async () => true);

		await setWorkingScopeCapability.run({ workflows: ['wf-1'], replace: true }, ctx);

		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), ['wf-1']);
	});

	test('buddy_set_working_scope returns partial when org approved but workflow denied', async () => {
		const ctx = ctxWithWorkflowResolver([{ id: 'wf-1', name: 'My Workflow' }]);
		let callCount = 0;
		setWorkingScopeApprover(async () => {
			callCount++;
			// First call = org approval (approve), second = workflow approval (deny).
			return callCount === 1;
		});

		const parsed = JSON.parse(
			await setWorkingScopeCapability.run({ orgs: ['org-1'], workflows: ['wf-1'] }, ctx),
		) as {
			status: string;
			approved: { orgs: string[]; workflows: string[] };
			denied: { orgs: string[]; workflows: string[] };
		};

		assert.strictEqual(parsed.status, 'partial');
		assert.deepStrictEqual(parsed.approved.orgs, ['org-1']);
		assert.deepStrictEqual(parsed.denied.workflows, ['wf-1']);
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1']);
		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), []);
	});

	test('buddy_set_working_scope throws when no session can resolve a workflow id', async () => {
		const ctx = ctxFor('org-1');
		setWorkingScopeApprover(async () => true);
		// No rawGraphql mock → session returns no workflow data → should throw.
		await assert.rejects(setWorkingScopeCapability.run({ workflows: ['wf-unknown'] }, ctx), /wf-unknown/);
	});

	test('working scope approval text surfaces requested org names and workflow names in the visible message', () => {
		const text = workingScopeApprovalText(
			{
				orgs: [{ id: 'org-1', name: 'Acme' }],
				workflows: [{ id: 'wf-1', name: 'My Workflow' }],
				replace: false,
			},
			'chat',
		);

		assert.match(text.message, /Cage-Free Rewsty/);
		assert.match(text.message, /Acme \(org-1\)/);
		assert.match(text.message, /My Workflow \(wf-1\)/);
		assert.match(text.detail, /Orgs: Acme \(org-1\)/);
		assert.match(text.detail, /Workflows: My Workflow \(wf-1\)/);
	});

	test('working scope approval text uses the MCP requester wording and "set" verb for replace requests', () => {
		const text = workingScopeApprovalText(
			{
				orgs: [{ id: 'org-1', name: 'Acme' }],
				workflows: [{ id: 'wf-1', name: 'My Workflow' }],
				replace: true,
			},
			'mcp',
		);

		assert.match(text.message, /An external MCP client/);
		assert.match(text.message, /wants to set the working scope/);
		assert.match(text.message, /Acme \(org-1\)/);
	});

	test('working scope approval text falls back to a generic target summary when nothing is requested', () => {
		const text = workingScopeApprovalText({ orgs: [], workflows: [], replace: false }, 'chat');

		assert.match(text.message, /add to the working scope for the requested targets/);
		assert.strictEqual(text.detail, '');
	});
});
