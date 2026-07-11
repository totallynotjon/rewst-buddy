import * as assert from 'assert';
import * as Mocha from 'mocha';
import { Session } from '@sessions';
import { clearCachedSession, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import {
	_resetMcpMutationApproverForTesting,
	setMcpMutationApprover,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import { _resetApprovedMutationScopes } from '../../ui/chat/tools/graphqlTool';
import { TEMPLATE_CLONE_CAPABILITIES } from '../../capabilities/templateCloneCapabilities';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

/**
 * Live verification for buddy_template_bundle_clone. It creates a small real
 * template bundle (a root that references a child), clones it, and asserts the
 * cloned root's body was rewritten to point at the cloned child — exercising the
 * end-to-end approval + create + updateTemplate flow against a real session.
 * Opt-in (token + REWST_TEST_WRITE=1) and always targets the token's own primary
 * configured sandbox org. Every created template — sources and clones — is
 * deleted in the finally block even if an assertion fails.
 */
function writeTestsEnabled(): boolean {
	return hasTestToken() && process.env.REWST_TEST_WRITE === '1';
}

function cap(name: string): Capability {
	const capability = TEMPLATE_CLONE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

suite('Integration: template bundle clone', function () {
	this.timeout(120_000);

	let session: Session;
	let ctx: CapabilityContext;
	let targetOrgId: string;

	suiteSetup(async function () {
		if (!writeTestsEnabled()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();
		targetOrgId = session.profile.org.id;
		if (!targetOrgId) {
			throw new Error('Refusing to run: the test session has no sandbox org id.');
		}
		ctx = { session, orgId: targetOrgId, sessions: [session] };
		console.log(`\n[itest] target org: ${session.profile.org.name} (${targetOrgId})`);
	});

	setup(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		setMcpMutationApprover(async () => true);
	});

	suiteTeardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		clearCachedSession();
	});

	test('clones a root + referenced child and rewrites the reference to the new child id', async () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const createdIds = new Set<string>();

		const create = async (name: string, body: string): Promise<string> => {
			const response = await session.sdk?.createTemplateMinimal({ name, orgId: targetOrgId, body });
			const id = response?.template?.id;
			if (!id) throw new Error(`failed to create template "${name}"`);
			createdIds.add(id);
			return id;
		};

		try {
			const childId = await create(`rb-itest-clone-child-${stamp}`, '{{ "child" }}');
			const rootId = await create(`rb-itest-clone-root-${stamp}`, `{{ template('${childId}') }}`);
			console.log('[itest] created source bundle', { rootId, childId });

			const result = JSON.parse(
				await cap('buddy_template_bundle_clone').run({ orgId: targetOrgId, rootTemplateId: rootId }, ctx),
			);
			assert.strictEqual(result.status, 'cloned');
			assert.strictEqual(result.count, 2, 'root + child cloned');
			assert.ok(Array.isArray(result.idMap) && result.idMap.length === 2);
			for (const node of result.idMap as { newId: string }[]) {
				createdIds.add(node.newId);
			}

			const newRootId: string = result.newRootTemplateId;
			const clonedChild = (result.idMap as { oldId: string; newId: string }[]).find(n => n.oldId === childId);
			assert.ok(newRootId, 'new root id returned');
			assert.ok(clonedChild, 'child was cloned');

			// The cloned root must reference the cloned child, not the original.
			const newRoot = await session.getTemplate(newRootId);
			assert.ok(newRoot.body.includes(clonedChild!.newId), 'reference rewritten to the cloned child id');
			assert.ok(!newRoot.body.includes(childId), 'original child id no longer present in the cloned root');

			console.log('[itest] clone rewrote the reference; target org will be cleaned up');
		} finally {
			for (const id of createdIds) {
				try {
					await session.sdk?.deleteTemplate({ id });
				} catch {
					// best-effort cleanup
				}
			}
		}
	});
});
