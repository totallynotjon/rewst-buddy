import type { Capability, CapabilityContext } from '@capabilities';
import type { Session } from '@sessions';
import { clearCachedSession, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { CRATE_CAPABILITIES } from '../../capabilities/crateCapabilities';
import { workflowImpactCapability } from '../../capabilities/workflowImpactCapability';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

function cap(name: string): Capability {
	const all: Capability[] = [...CRATE_CAPABILITIES, workflowImpactCapability];
	const capability = all.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

const FIND_PACK_ACTION_QUERY = `
query RbItestFindPackAction($orgId: ID!) {
  searchInstalledPackActions(orgId: $orgId, actionFilter: null) {
    id
    name
    ref
    actions {
      id
      name
      ref
    }
  }
}
`.trim();

const LIST_WORKFLOWS_QUERY = `
query RbItestListWorkflows($orgId: ID!, $limit: Int) {
  workflows(where: { orgId: $orgId }, limit: $limit, order: [["updatedAt", "DESC"]]) {
    id
    name
  }
}
`.trim();

suite('Integration: crate and impact probes', function () {
	this.timeout(120_000);

	let session: Session;
	let ctx: CapabilityContext;
	let targetOrgId: string;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();
		targetOrgId = session.profile.org.id;
		if (!targetOrgId) throw new Error('Refusing to run: the test session has no primary org id.');
		ctx = { session, orgId: targetOrgId, sessions: [session] };
		console.log(`\n[itest] target org: ${session.profile.org.name} (${targetOrgId})`);
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	test('buddy_search_crates catalog: resolves to non-empty string with id-shaped lines', async () => {
		const output = await cap('buddy_search_crates').run({ orgId: targetOrgId, limit: 5 }, ctx);
		assert.ok(typeof output === 'string' && output.length > 0, 'output is a non-empty string');
		// If any crates are listed, each line with a crate should have an id in parens
		const crateLines = output.split('\n').filter(l => l.startsWith('- '));
		for (const line of crateLines) {
			assert.match(line, /\(.+\)/, `crate line has id in parens: ${line}`);
		}
		console.log(`[itest] buddy_search_crates catalog: ${output.slice(0, 200)}`);
	});

	test('buddy_search_crates public: resolves to non-empty string', async () => {
		const output = await cap('buddy_search_crates').run({ orgId: targetOrgId, source: 'public', limit: 5 }, ctx);
		assert.ok(typeof output === 'string' && output.length > 0, 'output is a non-empty string');
		console.log(`[itest] buddy_search_crates public: ${output.slice(0, 200)}`);
	});

	test('buddy_workflow_impact workflowId mode: resolves (callers or no-callers message)', async () => {
		// Fetch one real workflow id from the sandbox
		const { data, errors } = await session.rawGraphql(LIST_WORKFLOWS_QUERY, {
			orgId: targetOrgId,
			limit: 1,
		});
		if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
			throw new Error(`LIST_WORKFLOWS_QUERY error: ${JSON.stringify(errors)}`);
		}
		const workflows = (data as { workflows?: { id: string; name: string }[] } | undefined)?.workflows ?? [];
		if (workflows.length === 0) {
			console.log('[itest] buddy_workflow_impact workflowId: no workflows in sandbox, skipping');
			return;
		}
		const workflowId = workflows[0].id;
		console.log(`[itest] probing parentWorkflows for workflow ${workflowId}`);

		const output = await cap('buddy_workflow_impact').run({ orgId: targetOrgId, workflowId }, ctx);
		assert.ok(typeof output === 'string' && output.length > 0, 'output is a non-empty string');
		// Must be either the callers list or the no-callers message
		const hasCallers = output.includes('workflow(s) call');
		const noCallers = output.includes('No workflows call');
		assert.ok(hasCallers || noCallers, `output is a callers list or no-callers message: ${output.slice(0, 200)}`);
		console.log(`[itest] buddy_workflow_impact workflowId: ${output.slice(0, 200)}`);
	});

	test('buddy_workflow_impact actions mode: resolves (affected or no-affected message)', async function () {
		// Resolve one real installed pack ref + action ref
		const { data, errors } = await session.rawGraphql(FIND_PACK_ACTION_QUERY, { orgId: targetOrgId });
		if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
			throw new Error(`FIND_PACK_ACTION_QUERY error: ${JSON.stringify(errors)}`);
		}
		const packs =
			(
				data as
					| {
							searchInstalledPackActions?: {
								id: string;
								name: string;
								ref: string;
								actions: { id: string; name: string; ref: string | null }[];
							}[];
					  }
					| undefined
			)?.searchInstalledPackActions ?? [];

		// Find first pack with a non-null ref and at least one action with a non-null ref
		let packRef: string | undefined;
		let actionRef: string | undefined;
		for (const pack of packs) {
			if (!pack.ref) continue;
			const action = pack.actions.find(a => a.ref != null);
			if (action?.ref) {
				packRef = pack.ref;
				actionRef = action.ref;
				break;
			}
		}

		if (!packRef || !actionRef) {
			console.log('[itest] buddy_workflow_impact actions: no installed pack with action ref found, skipping');
			this.skip();
			return;
		}

		console.log(`[itest] probing workflowsAffectedByBreakingChanges for pack=${packRef} action=${actionRef}`);
		const output = await cap('buddy_workflow_impact').run(
			{ orgId: targetOrgId, actions: [{ packRef, actionRefs: [actionRef] }] },
			ctx,
		);
		assert.ok(typeof output === 'string' && output.length > 0, 'output is a non-empty string');
		const hasAffected = output.includes('workflow(s) affected');
		const noAffected = output.includes('No workflows');
		assert.ok(hasAffected || noAffected, `output is affected list or no-affected message: ${output.slice(0, 200)}`);
		console.log(`[itest] buddy_workflow_impact actions: ${output.slice(0, 200)}`);
	});
});
