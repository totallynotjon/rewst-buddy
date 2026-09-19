import {
	clearCachedSession,
	getTestOrgId,
	getTestSession,
	hasTestToken,
	initTestEnvironment,
	installMockSessionsAndWait,
} from '@test';
import * as assert from 'assert';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as Mocha from 'mocha';
import type { Capability, CapabilityContext } from '../../../packages/mcp-server/src/capabilities/Capability';
import { getCapability } from '../../../packages/mcp-server/src/capabilities/registry';
import { resolveDefaultExportDir } from '../../../packages/mcp-server/src/export/exportStorage';
import type { Session } from '../../../packages/mcp-server/src/sessions';
import { rawGraphqlOrThrow } from '../../capabilities/inputHelpers';
import { editorDataClient } from '../../backend/editorDataClient';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

function cap(name: string): Capability {
	const capability = getCapability(name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

const SANDBOX_WORKFLOWS = `query RbItestExportWorkflows($orgId: ID!) {
  workflows(where: { orgId: $orgId }, limit: 5, order: [["updatedAt", "DESC"]]) {
    id name orgId
  }
}`;

const WORKFLOW_BY_ID = `query RbItestExportWorkflowById($id: ID!) {
  workflow(where: { id: $id }) { id name orgId }
}`;

interface WorkflowRow {
	id: string;
	name: string;
	orgId?: string;
}

/**
 * Live read-only verification for buddy_export_workflows, opt-in behind
 * REWST_TEST_TOKEN and scoped to REWST_TEST_ORG_ID. Exports one
 * organization-owned sandbox workflow to an approved outputPath, asserts the
 * saved file matches the inline signed bundle with signing intact, and
 * verifies the workflow is unchanged afterwards. Cleans up the saved file.
 * (Oversized-result paging through buddy_result_read is covered behaviorally
 * in src/capabilities/registry.test.ts; live sandbox bundle sizes are not
 * controllable, so this suite asserts the inline-or-cache-id contract instead
 * of forcing an oversized bundle.)
 */
suite('Integration: workflow export (read-only)', function () {
	this.timeout(120_000);

	let session: Session;
	let ctx: CapabilityContext;
	let targetOrgId: string;
	let workflows: WorkflowRow[] = [];

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		targetOrgId = getTestOrgId();
		session = await getTestSession();
		if (
			session.profile.org.id !== targetOrgId ||
			session.profile.allManagedOrgs.some(org => org.id !== targetOrgId)
		) {
			throw new Error('Safety invariant failed: test session is not sandbox-only.');
		}
		ctx = { session, orgId: targetOrgId, sessions: [session] };
		await installMockSessionsAndWait([session]);

		const data = (await rawGraphqlOrThrow(session, SANDBOX_WORKFLOWS, { orgId: targetOrgId })) as {
			workflows?: WorkflowRow[];
		};
		workflows = (data.workflows ?? []).filter(row => row?.id && row.orgId === targetOrgId);
		console.log(
			`\n[itest] target org: ${session.profile.org.name} (${targetOrgId}), workflows: ${workflows.length}`,
		);
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	test('exports an org-owned workflow and saves the unchanged signed bundle', async function () {
		if (workflows.length === 0) {
			this.skip();
			return;
		}
		const target = workflows[0] as WorkflowRow;

		const before = (await rawGraphqlOrThrow(session, WORKFLOW_BY_ID, { id: target.id })) as {
			workflow?: { id: string; name: string; orgId?: string } | null;
		};
		assert.ok(before.workflow, 'Expected the sandbox workflow to exist before export.');
		assert.strictEqual(before.workflow?.orgId, targetOrgId);

		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const outputPath = join(resolveDefaultExportDir(), `rb-itest-workflow-export-${stamp}.json`);
		await mkdir(dirname(outputPath), { recursive: true });

		let savedPath: string | undefined;
		try {
			const result = JSON.parse(
				await cap('buddy_export_workflows').run(
					{ orgId: targetOrgId, workflowIds: [target.id], outputPath, includeBundle: true },
					ctx,
				),
			) as {
				status?: unknown;
				outputPath?: unknown;
				bytes?: unknown;
				version?: unknown;
				exportedAt?: unknown;
				objectCount?: unknown;
				signingPresent?: unknown;
				bundle?: unknown;
			};

			assert.strictEqual(result.status, 'saved');
			assert.strictEqual(result.outputPath, outputPath);
			assert.strictEqual(result.signingPresent, true);
			savedPath = result.outputPath as string;

			const onDisk = JSON.parse(await readFile(outputPath, 'utf8')) as {
				version?: unknown;
				exportedAt?: unknown;
				signing?: unknown;
			};
			assert.deepStrictEqual(result.bundle, onDisk);
			assert.ok(onDisk.signing !== null && onDisk.signing !== undefined, 'Expected signing intact.');
			assert.ok(onDisk.version !== undefined && onDisk.exportedAt !== undefined);

			const after = (await rawGraphqlOrThrow(session, WORKFLOW_BY_ID, { id: target.id })) as {
				workflow?: { id: string; name: string; orgId?: string } | null;
			};
			assert.deepStrictEqual(after.workflow, before.workflow);
		} finally {
			if (savedPath) await unlink(savedPath).catch(() => {});
		}
	});

	test('exports through the editor data client and propagates backend errors', async function () {
		if (workflows.length === 0) {
			this.skip();
			return;
		}
		const target = workflows[0] as WorkflowRow;
		const sessionId = session.profile.user.id;
		assert.ok(sessionId, 'Expected the integration session to have a user id.');

		const catalog = await editorDataClient.listExportWorkflows({ sessionId, orgId: targetOrgId });
		const catalogTarget = catalog.find(row => row.id === target.id);
		assert.ok(catalogTarget, 'Expected the editor catalog operation to return the sandbox workflow.');

		const defaultDirectory = await editorDataClient.getWorkflowExportDefaultDirectory();
		const outputPath = join(defaultDirectory, `rb-itest-editor-export-${Date.now()}.json`);
		await mkdir(dirname(outputPath), { recursive: true });
		try {
			const result = await editorDataClient.exportWorkflows({
				sessionId,
				orgId: targetOrgId,
				workflowIds: [target.id],
				outputPath,
			});

			assert.strictEqual(result.status, 'saved');
			assert.strictEqual(result.outputPath, outputPath);
			assert.deepStrictEqual(JSON.parse(await readFile(outputPath, 'utf8')).signing !== undefined, true);

			await assert.rejects(
				() =>
					editorDataClient.exportWorkflows({
						sessionId,
						orgId: targetOrgId,
						workflowIds: ['workflow-does-not-exist'],
						outputPath: join(defaultDirectory, `rb-itest-editor-error-${Date.now()}.json`),
					}),
				/does not belong to organization|not found|workflow/i,
			);
		} finally {
			await unlink(outputPath).catch(() => {});
		}
	});
});
