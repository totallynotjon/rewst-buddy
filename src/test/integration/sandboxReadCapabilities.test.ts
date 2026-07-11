import { getCapability, type Capability, type CapabilityContext } from '@capabilities';
import type { Session } from '@sessions';
import { clearCachedSession, getTestOrgId, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import * as assert from 'assert';
import { randomUUID } from 'crypto';
import * as Mocha from 'mocha';
import { rawGraphqlOrThrow } from '../../capabilities/inputHelpers';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

interface WorkflowRow {
	id: string;
	name: string;
	orgId?: string;
}

interface TemplateRow {
	id: string;
	name: string;
	orgId?: string;
}

function cap(name: string): Capability {
	const capability = getCapability(name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

function nonEmptyLines(output: string): string[] {
	return output.split('\n').filter(line => line.trim().length > 0);
}

const SANDBOX_RESOURCES = `query RbItestSandboxResources($orgId: ID!) {
  workflows(where: { orgId: $orgId }, limit: 10, order: [["updatedAt", "DESC"]]) {
    id name orgId
  }
  templates(where: { orgId: $orgId }, limit: 10, order: [["updatedAt", "DESC"]]) {
    id name orgId
  }
}`;

const FIRST_PATCH = `query RbItestSandboxPatch($workflowId: ID!) {
  workflowPatches(where: { workflowId: $workflowId }, limit: 1, orderBy: createdAt_DESC) { id }
}`;

suite('Integration: sandbox read capability tree', function () {
	this.timeout(120_000);

	let session: Session;
	let ctx: CapabilityContext;
	let orgId: string;
	let workflows: WorkflowRow[] = [];
	let templates: TemplateRow[] = [];
	let firstPatchId: string | undefined;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		orgId = getTestOrgId();
		session = await getTestSession();
		if (session.profile.org.id !== orgId) {
			throw new Error(`Safety invariant failed: test session is not bound to sandbox ${orgId}.`);
		}
		ctx = { session, orgId, sessions: [session] };

		const data = (await rawGraphqlOrThrow(session, SANDBOX_RESOURCES, { orgId })) as {
			workflows?: WorkflowRow[];
			templates?: TemplateRow[];
		};
		workflows = data.workflows ?? [];
		templates = data.templates ?? [];
		for (const row of [...workflows, ...templates]) {
			assert.strictEqual(row.orgId, orgId, `discovery returned an out-of-sandbox resource: ${row.id}`);
		}

		if (workflows[0]) {
			const patchData = (await rawGraphqlOrThrow(session, FIRST_PATCH, {
				workflowId: workflows[0].id,
			})) as { workflowPatches?: { id?: string }[] };
			firstPatchId = patchData.workflowPatches?.[0]?.id;
		}
		console.log(
			`\n[itest] sandbox ${session.profile.org.name} (${orgId}): ${workflows.length} workflow probe(s), ${templates.length} template probe(s)`,
		);
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	test('the integration SessionProfile exposes only the configured sandbox tree', () => {
		const scopedUser = session.profile.user as typeof session.profile.user & {
			allManagedOrgs: { id?: string | null }[];
			organization?: { managedAndSubOrgs?: { id?: string | null }[] } | null;
		};
		assert.strictEqual(session.profile.org.id, orgId);
		assert.deepStrictEqual(
			session.profile.allManagedOrgs.map(org => org.id),
			[orgId],
		);
		assert.strictEqual(session.profile.user.orgId, orgId);
		assert.deepStrictEqual(
			scopedUser.allManagedOrgs.map(org => org.id),
			[orgId],
		);
		assert.deepStrictEqual(
			scopedUser.organization?.managedAndSubOrgs?.map(org => org.id),
			[orgId],
		);
	});

	test('buddy_list_orgs sees only the sandbox-scoped profile', async () => {
		const output = await cap('buddy_list_orgs').run({}, ctx);
		assert.ok(output.includes(orgId), output);
		assert.strictEqual(nonEmptyLines(output).length, 1, output);
	});

	test('buddy_list_workflows returns only bounded sandbox workflow rows', async () => {
		const output = await cap('buddy_list_workflows').run({ orgId, limit: 3 }, ctx);
		const lines = nonEmptyLines(output);
		assert.ok(lines.length >= 1 && lines.length <= 3, output);
		if (workflows.length > 0) assert.match(lines[0], /\([^)]+\)/);
	});

	test('buddy_list_workflows name filtering finds a dynamically discovered sandbox workflow', async function () {
		const workflow = workflows[0];
		if (!workflow) {
			this.skip();
			return;
		}
		const output = await cap('buddy_list_workflows').run({ orgId, search: workflow.name, limit: 10 }, ctx);
		assert.ok(output.includes(workflow.id), output);
	});

	test('buddy_get_workflow returns sandbox metadata for a discovered workflow', async function () {
		const workflow = workflows[0];
		if (!workflow) {
			this.skip();
			return;
		}
		const output = JSON.parse(await cap('buddy_get_workflow').run({ orgId, workflowId: workflow.id }, ctx));
		assert.strictEqual(output.id, workflow.id);
		assert.strictEqual(output.orgId, orgId);
		assert.ok(Array.isArray(output.triggers));
	});

	test('buddy_list_workflow_tasks traverses the discovered workflow child collection', async function () {
		const workflow = workflows[0];
		if (!workflow) {
			this.skip();
			return;
		}
		const output = await cap('buddy_list_workflow_tasks').run({ orgId, workflowId: workflow.id, limit: 5 }, ctx);
		assert.ok(output.length > 0);
		assert.ok(nonEmptyLines(output).length <= 5 || output.startsWith('No workflow tasks found'), output);
	});

	test('buddy_workflow_lint audits a live sandbox workflow without changing it', async function () {
		const workflow = workflows[0];
		if (!workflow) {
			this.skip();
			return;
		}
		const output = await cap('buddy_workflow_lint').run({ orgId, workflowId: workflow.id }, ctx);
		assert.ok(output.includes(workflow.id), output);
		assert.ok(/No issues found|issue\(s\)/.test(output), output);
	});

	test('buddy_list_workflow_patches returns a bounded history or its documented empty state', async function () {
		const workflow = workflows[0];
		if (!workflow) {
			this.skip();
			return;
		}
		const output = await cap('buddy_list_workflow_patches').run({ orgId, workflowId: workflow.id, limit: 3 }, ctx);
		assert.ok(nonEmptyLines(output).length <= 3, output);
		assert.ok(firstPatchId ? output.includes(firstPatchId) : output.includes('No workflow patches found'), output);
	});

	test('buddy_get_workflow_patch reads a patch discovered beneath the sandbox workflow', async function () {
		if (!firstPatchId) {
			this.skip();
			return;
		}
		const output = JSON.parse(await cap('buddy_get_workflow_patch').run({ orgId, patchId: firstPatchId }, ctx));
		assert.strictEqual(output.id, firstPatchId);
		assert.ok(Array.isArray(output.patch), 'patch payload is RFC-6902 shaped');
	});

	test('buddy_recent_workflow_edits is bounded to the sandbox org and limit', async () => {
		const output = await cap('buddy_recent_workflow_edits').run({ orgId, limit: 3 }, ctx);
		const lines = nonEmptyLines(output);
		assert.ok(lines.length >= 1 && lines.length <= 3, output);
		assert.ok(/updated .* by /.test(output) || output.includes('No recently edited workflows'), output);
	});

	test('buddy_get_workflow_execution_stats returns every documented status bucket', async () => {
		const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const output = await cap('buddy_get_workflow_execution_stats').run({ orgId, createdSince: since }, ctx);
		if (output.startsWith('No workflow execution stats')) return;
		for (const key of ['succeeded', 'failed', 'running', 'pending', 'paused', 'delayed', 'humanSecondsSaved']) {
			assert.match(output, new RegExp(`^${key}: \\d+`, 'm'), output);
		}
	});

	test('buddy_resolve_reference resolves a discovered sandbox workflow by name', async function () {
		const workflow = workflows[0];
		if (!workflow) {
			this.skip();
			return;
		}
		const output = await cap('buddy_resolve_reference').run(
			{ orgId, modelType: 'Workflow', search: workflow.name, limit: 10 },
			ctx,
		);
		assert.ok(output.includes(workflow.id), output);
	});

	test('buddy_find_executions_by_variable scans only one discovered sandbox workflow', async function () {
		const workflow = workflows[0];
		if (!workflow) {
			this.skip();
			return;
		}
		const output = await cap('buddy_find_executions_by_variable').run(
			{ orgId, workflowId: workflow.id, name: `rb_itest_absent_${randomUUID()}`, limit: 2 },
			ctx,
		);
		assert.match(output, /No executions of this workflow \(scanned \d+\)/, output);
	});

	test('buddy_search_templates finds a dynamically discovered sandbox template', async function () {
		const template = templates[0];
		if (!template) {
			this.skip();
			return;
		}
		const output = await cap('buddy_search_templates').run({ orgId, search: template.name, limit: 10 }, ctx);
		assert.ok(output.includes(template.id), output);
	});

	test('buddy_get_template returns the full body and sandbox ownership', async function () {
		const template = templates[0];
		if (!template) {
			this.skip();
			return;
		}
		const output = JSON.parse(await cap('buddy_get_template').run({ orgId, templateId: template.id }, ctx));
		assert.strictEqual(output.id, template.id);
		assert.strictEqual(output.orgId, orgId);
		assert.strictEqual(typeof output.body, 'string');
	});

	test('buddy_resolve_reference resolves a discovered sandbox template by name', async function () {
		const template = templates[0];
		if (!template) {
			this.skip();
			return;
		}
		const output = await cap('buddy_resolve_reference').run(
			{ orgId, modelType: 'Template', search: template.name, limit: 10 },
			ctx,
		);
		assert.ok(output.includes(template.id), output);
	});

	test('buddy_graphql_query binds the sandbox org variable and returns no other org ids', async () => {
		const query = `query RbItestScopedRawRead($orgId: ID!) {
			workflows(where: { orgId: $orgId }, limit: 5) { id orgId }
		}`;
		const output = JSON.parse(await cap('buddy_graphql_query').run({ orgId, query, variables: {} }, ctx));
		const rows = (output.data?.workflows ?? []) as { id: string; orgId: string }[];
		assert.ok(
			rows.every(row => row.orgId === orgId),
			JSON.stringify(rows),
		);
	});

	test('missing workflow ids fail cleanly while remaining sandbox-scoped', async () => {
		const missing = randomUUID();
		await assert.rejects(
			() => cap('buddy_get_workflow').run({ orgId, workflowId: missing }, ctx),
			new RegExp(`Workflow not found: ${missing}`),
		);
	});
});
