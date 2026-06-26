import * as assert from 'assert';
import * as Mocha from 'mocha';
import { WorkingScopeManager } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import type { CapabilityContext } from './Capability';
import {
	_resetWorkingScopeApproverForTesting,
	getWorkingScopeCapability,
	setWorkingScopeApprover,
	setWorkingScopeCapability,
} from './workingScopeCapability';

const { suite, test, setup, teardown } = Mocha;

function ctxFor(orgId = 'org-1', orgName = 'Acme'): CapabilityContext {
	const { session } = createMockSession({ profile: { org: { id: orgId, name: orgName } } });
	SessionManager._setSessionsForTesting([session]);
	return { session, orgId, sessions: SessionManager.getActiveSessions() };
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

	test('get_working_scope reports the current scope', async () => {
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

	test('set_working_scope requires at least one org or workflow', async () => {
		const ctx = ctxFor();
		await assert.rejects(setWorkingScopeCapability.run({}, ctx), /at least one/i);
	});

	test('set_working_scope rejects an org no session manages', async () => {
		const ctx = ctxFor('org-1');
		setWorkingScopeApprover(async () => true);
		await assert.rejects(setWorkingScopeCapability.run({ orgs: ['org-999'] }, ctx), /org-999/);
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), []);
	});

	test('set_working_scope does not change the scope when the user declines', async () => {
		const ctx = ctxFor('org-1');
		setWorkingScopeApprover(async () => false);

		const parsed = JSON.parse(await setWorkingScopeCapability.run({ orgs: ['org-1'] }, ctx)) as {
			status: string;
		};

		assert.strictEqual(parsed.status, 'approval_required');
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), []);
	});

	test('set_working_scope adds to the scope after approval', async () => {
		const ctx = ctxFor('org-1');
		WorkingScopeManager.setOrgs(['org-existing']);
		setWorkingScopeApprover(async () => true);

		const parsed = JSON.parse(
			await setWorkingScopeCapability.run({ orgs: ['org-1'], workflows: ['wf-1'] }, ctx),
		) as {
			status: string;
			scope: { orgs: string[]; workflows: string[] };
		};

		assert.strictEqual(parsed.status, 'ok');
		assert.deepStrictEqual(parsed.scope.orgs.sort(), ['org-1', 'org-existing']);
		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), ['wf-1']);
	});

	test('set_working_scope replaces the named dimension when replace is true', async () => {
		const ctx = ctxFor('org-1');
		WorkingScopeManager.setOrgs(['org-existing']);
		WorkingScopeManager.setWorkflows(['wf-keep']);
		setWorkingScopeApprover(async () => true);

		await setWorkingScopeCapability.run({ orgs: ['org-1'], replace: true }, ctx);

		// orgs replaced, workflows untouched (not named in the call).
		assert.deepStrictEqual(WorkingScopeManager.getOrgs(), ['org-1']);
		assert.deepStrictEqual(WorkingScopeManager.getWorkflows(), ['wf-keep']);
	});
});
