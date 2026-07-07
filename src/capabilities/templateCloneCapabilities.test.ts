import { _resetMcpMutationApproverForTesting, setMcpMutationApprover, type CapabilityContext } from '@capabilities';
import { LinkManager } from '@models';
import type { FullTemplateFragment, Session } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetApprovedMutationScopes, type MutationScope } from '../ui/chat/tools/graphqlTool';
import {
	defaultTemplateCloneDeps,
	rewriteReferences,
	runBundleClone,
	TEMPLATE_CLONE_CAPABILITIES,
	type TemplateCloneDeps,
} from './templateCloneCapabilities';

const { suite, test, setup, teardown } = Mocha;

// Valid UUIDs so findAllTemplateReferences' pattern matches.
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const FOREIGN = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const MISSING = '99999999-9999-9999-9999-999999999999';

function refBody(ids: string[]): string {
	return ids.map(id => `{{ template('${id}') }}`).join('\n');
}

function tmpl(id: string, over: Partial<FullTemplateFragment> = {}): FullTemplateFragment {
	return {
		id,
		name: `T-${id.slice(0, 4)}`,
		body: '',
		updatedAt: '1',
		orgId: 'src-org',
		organization: { id: 'src-org', name: 'Source' },
		contentType: 'text',
		language: 'jinja',
		context: null,
		cloneOverrides: null,
		description: null,
		tags: [],
		...over,
	} as unknown as FullTemplateFragment;
}

interface CloneDepOpts {
	failCreateAt?: number;
	failUpdateAt?: number;
}

type CloneUpdateArg = Parameters<TemplateCloneDeps['updateTemplate']>[1];

function makeCloneDeps(remote: Record<string, FullTemplateFragment>, opts: CloneDepOpts = {}) {
	const calls = {
		getTemplate: [] as string[],
		create: [] as { name: string; orgId: string }[],
		update: [] as CloneUpdateArg[],
		del: [] as string[],
	};
	let createCount = 0;
	let updateCount = 0;
	let idSeq = 0;
	const deps: TemplateCloneDeps = {
		getTemplate: async (_s, id) => {
			calls.getTemplate.push(id);
			const t = remote[id];
			if (!t) throw new Error(`not found: ${id}`);
			return t;
		},
		createTemplate: async (_s, name, orgId) => {
			createCount++;
			calls.create.push({ name, orgId });
			if (opts.failCreateAt === createCount) throw new Error('create boom');
			return { id: `new-${++idSeq}` };
		},
		updateTemplate: async (_s, update) => {
			updateCount++;
			calls.update.push(update);
			if (opts.failUpdateAt === updateCount) throw new Error('update boom');
		},
		deleteTemplate: async (_s, id) => {
			calls.del.push(id);
		},
	};
	return { deps, calls };
}

function makeCtx(targetOrgId = 'tgt-org'): CapabilityContext {
	const session = {
		profile: { org: { id: targetOrgId, name: 'Target' }, allManagedOrgs: [{ id: targetOrgId, name: 'Target' }] },
	} as unknown as Session;
	return { session, orgId: targetOrgId, sessions: [session] };
}

suite('Unit: templateCloneCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		LinkManager._resetForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		LinkManager._resetForTesting();
	});

	// --- Zod parse tests ---
	test('missing rootTemplateId throws before any fetch', async () => {
		const { deps } = makeCloneDeps({});
		await assert.rejects(() => runBundleClone({ orgId: 'tgt-org' }, makeCtx(), deps), /rootTemplateId/);
	});

	test('missing orgId throws before any fetch', async () => {
		const { deps } = makeCloneDeps({});
		await assert.rejects(() => runBundleClone({ rootTemplateId: A }, makeCtx(), deps), /orgId/);
	});

	test('maxTemplates floors and clamps to 200', async () => {
		setMcpMutationApprover(async () => true);
		const { deps } = makeCloneDeps({ [A]: tmpl(A) });
		// Should not throw; 9999 clamps to 200
		await assert.doesNotReject(() =>
			runBundleClone({ orgId: 'tgt-org', rootTemplateId: A, maxTemplates: 9999 }, makeCtx(), deps),
		);
	});

	test('buddy_template_bundle_clone derived schema has orgId and rootTemplateId required and args generated', () => {
		const c = TEMPLATE_CLONE_CAPABILITIES.find(x => x.spec.name === 'buddy_template_bundle_clone');
		assert.ok(c);
		const schema = c.spec.inputSchema as { required: string[] };
		assert.ok(schema.required.includes('orgId'));
		assert.ok(schema.required.includes('rootTemplateId'));
		assert.strictEqual(c.spec.args, JSON.stringify(schema));
	});

	suite('rewriteReferences', () => {
		test('rewrites mapped ids, leaves unmapped refs and surrounding Jinja intact', () => {
			const map = new Map([[A, 'new-1']]);
			const body = `{{ template('${A}') }} and {{ template('${B}') }}`;
			const out = rewriteReferences(body, map);
			assert.ok(out.includes("template('new-1')"), 'mapped ref rewritten');
			assert.ok(out.includes(`template('${B}')`), 'unmapped ref left as-is');
		});

		test('matches case-insensitively against canonical (lowercase) keys', () => {
			const map = new Map([[A, 'new-1']]);
			const out = rewriteReferences(`{{ template('${A.toUpperCase()}') }}`, map);
			assert.ok(out.includes("template('new-1')"), 'uppercase ref still rewritten');
		});
	});

	suite('capability descriptor', () => {
		test('buddy_template_bundle_clone is a write tool, mcp-only, org-scoped', () => {
			const c = TEMPLATE_CLONE_CAPABILITIES.find(x => x.spec.name === 'buddy_template_bundle_clone');
			assert.ok(c);
			assert.strictEqual(c.access, 'write');
			assert.notStrictEqual(c.requiresOrg, false);
		});
	});

	suite('approval', () => {
		test('creates nothing when approval is denied', async () => {
			const { deps, calls } = makeCloneDeps({ [A]: tmpl(A) });
			setMcpMutationApprover(async () => false);
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps));
			assert.strictEqual(out.status, 'approval_required');
			assert.strictEqual(calls.create.length, 0);
		});

		test('prompts once for the whole bundle, scoped to (org, root)', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }), [B]: tmpl(B, { body: refBody([C]) }), [C]: tmpl(C) };
			const { deps } = makeCloneDeps(remote);
			let approverCalls = 0;
			let scope: MutationScope | undefined;
			setMcpMutationApprover(async s => {
				approverCalls++;
				scope = s;
				return true;
			});

			await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps);

			assert.strictEqual(approverCalls, 1, 'one approval for the whole clone');
			assert.strictEqual(scope?.scopeId, `clone:${A}`, 'scope is per-(org, root)');
		});

		test('reuses approval for the same root but re-prompts for a different root', async () => {
			const remote = { [A]: tmpl(A), [B]: tmpl(B) };
			const { deps } = makeCloneDeps(remote);
			let approverCalls = 0;
			setMcpMutationApprover(async () => {
				approverCalls++;
				return true;
			});

			await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps);
			await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps);
			assert.strictEqual(approverCalls, 1, 'same root reuses approval');

			await runBundleClone({ orgId: 'tgt-org', rootTemplateId: B }, makeCtx(), deps);
			assert.strictEqual(approverCalls, 2, 'a different root re-prompts');
		});
	});

	suite('cloning', () => {
		setup(() => setMcpMutationApprover(async () => true));

		test('clones a single template with no references', async () => {
			const { deps, calls } = makeCloneDeps({ [A]: tmpl(A, { body: 'hello' }) });
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps));
			assert.strictEqual(out.status, 'cloned');
			assert.strictEqual(out.count, 1);
			assert.strictEqual(out.newRootTemplateId, 'new-1');
			assert.strictEqual(calls.create.length, 1);
			assert.strictEqual(calls.update.length, 1);
		});

		test('rewrites references to the new ids along a chain', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }), [B]: tmpl(B, { body: refBody([C]) }), [C]: tmpl(C) };
			const { deps, calls } = makeCloneDeps(remote);
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps));

			assert.strictEqual(out.count, 3);
			const rootUpdate = calls.update.find(u => u.id === 'new-1');
			assert.ok(rootUpdate, 'root clone updated');
			assert.ok(rootUpdate.body.includes("template('new-2')"), 'reference rewritten to the clone id');
			assert.ok(!rootUpdate.body.includes(B), 'old id no longer present');
		});

		test('copies source contentType / language / context / cloneOverrides / description onto each clone', async () => {
			const remote = {
				[A]: tmpl(A, {
					body: 'print(1)',
					contentType: 'powershell',
					language: 'python',
					context: { x: 1 },
					cloneOverrides: { y: 2 },
					description: 'a real description',
				}),
			};
			const { deps, calls } = makeCloneDeps(remote);
			await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps);
			const update = calls.update[0];
			assert.strictEqual(update.language, 'python');
			assert.strictEqual(update.contentType, 'powershell');
			assert.deepStrictEqual(update.context, { x: 1 });
			assert.deepStrictEqual(update.cloneOverrides, { y: 2 });
			assert.strictEqual(update.description, 'a real description');
		});

		test('creates no local file or link (clone is remote-only)', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }), [B]: tmpl(B) };
			const { deps } = makeCloneDeps(remote);

			await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps);

			assert.strictEqual(LinkManager.getAllTemplateLinks().length, 0, 'no local link was created');
		});

		test('handles a cycle without looping forever', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }), [B]: tmpl(B, { body: refBody([A]) }) };
			const { deps, calls } = makeCloneDeps(remote);
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps));
			assert.strictEqual(out.count, 2);
			assert.strictEqual(calls.create.length, 2);
		});

		test('clones a shared (diamond) dependency only once', async () => {
			const remote = {
				[A]: tmpl(A, { body: refBody([B, C]) }),
				[B]: tmpl(B, { body: refBody([D]) }),
				[C]: tmpl(C, { body: refBody([D]) }),
				[D]: tmpl(D),
			};
			const { deps, calls } = makeCloneDeps(remote);
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps));
			assert.strictEqual(out.count, 4, 'D cloned once');
			assert.strictEqual(calls.create.length, 4);
		});

		test('dedupes case-variant references to one clone', async () => {
			const remote = {
				[A]: tmpl(A, { body: refBody([B.toUpperCase(), C]) }),
				[B]: tmpl(B),
				[C]: tmpl(C, { body: refBody([B]) }),
			};
			const { deps } = makeCloneDeps(remote);
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps));
			assert.strictEqual(out.count, 3, 'B cloned once despite mixed-case references');
		});

		test('reports a missing referenced template and still clones the root', async () => {
			const { deps } = makeCloneDeps({ [A]: tmpl(A, { body: refBody([MISSING]) }) });
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps));
			assert.strictEqual(out.count, 1);
			assert.deepStrictEqual(out.missingReferences, [MISSING]);
		});

		test('reports a foreign-org reference and does not clone it', async () => {
			const remote = {
				[A]: tmpl(A, { body: refBody([FOREIGN]) }),
				[FOREIGN]: tmpl(FOREIGN, { orgId: 'other-org' }),
			};
			const { deps } = makeCloneDeps(remote);
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps));
			assert.strictEqual(out.count, 1);
			assert.deepStrictEqual(out.foreignReferences, [{ refId: FOREIGN, orgId: 'other-org' }]);
		});

		test('bounds the walk by maxDepth and reports the dropped child', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }), [B]: tmpl(B, { body: refBody([C]) }), [C]: tmpl(C) };
			const { deps } = makeCloneDeps(remote);
			const out = JSON.parse(
				await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A, maxDepth: 1 }, makeCtx(), deps),
			);
			assert.strictEqual(out.count, 2, 'A and B only');
			assert.deepStrictEqual(out.skipped.depth, [C], 'reports the omitted child, not the cloned parent');
		});

		test('bounds the walk by maxTemplates', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B, C]) }), [B]: tmpl(B), [C]: tmpl(C) };
			const { deps } = makeCloneDeps(remote);
			const out = JSON.parse(
				await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A, maxTemplates: 2 }, makeCtx(), deps),
			);
			assert.strictEqual(out.count, 2);
			assert.deepStrictEqual(out.skipped.cap, [C]);
		});

		test('creates every clone in the target org', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }), [B]: tmpl(B) };
			const { deps, calls } = makeCloneDeps(remote);
			await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps);
			assert.ok(
				calls.create.every(c => c.orgId === 'tgt-org'),
				'all creates target the requested org',
			);
		});

		test('fetches the root from a later session when the first cannot', async () => {
			const remote = { [A]: tmpl(A) };
			const { deps } = makeCloneDeps(remote);
			const base = deps.getTemplate;
			const s1 = {} as unknown as Session;
			const s2 = {
				profile: {
					org: { id: 'tgt-org', name: 'Target' },
					allManagedOrgs: [{ id: 'tgt-org', name: 'Target' }],
				},
			} as unknown as Session;
			deps.getTemplate = async (s, id) => {
				if (s === s1) throw new Error('first session cannot read it');
				return base(s, id);
			};
			const ctx = { session: s2, orgId: 'tgt-org', sessions: [s1, s2] } as unknown as CapabilityContext;
			const out = JSON.parse(await runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, ctx, deps));
			assert.strictEqual(out.status, 'cloned');
			assert.strictEqual(out.count, 1);
		});

		test('aborts without creating anything when a reference fetch fails operationally', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }) };
			const { deps, calls } = makeCloneDeps(remote);
			const base = deps.getTemplate;
			deps.getTemplate = async (s, id) => {
				if (id === B) throw new Error('Network error: ECONNRESET');
				return base(s, id);
			};
			await assert.rejects(
				() => runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps),
				/Network error/,
			);
			assert.strictEqual(calls.create.length, 0, 'no clones created on an operational failure');
		});

		test('rolls back every created template when an update fails', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }), [B]: tmpl(B) };
			const { deps, calls } = makeCloneDeps(remote, { failUpdateAt: 2 });
			await assert.rejects(
				() => runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps),
				/Clone failed.*Rolled back all 2/,
			);
			assert.deepStrictEqual(calls.del, ['new-1', 'new-2'], 'both clones deleted');
		});

		test('rolls back only the templates created so far when a create fails', async () => {
			const remote = { [A]: tmpl(A, { body: refBody([B]) }), [B]: tmpl(B) };
			const { deps, calls } = makeCloneDeps(remote, { failCreateAt: 2 });
			await assert.rejects(
				() => runBundleClone({ orgId: 'tgt-org', rootTemplateId: A }, makeCtx(), deps),
				/Clone failed.*create boom/,
			);
			assert.deepStrictEqual(calls.del, ['new-1'], 'only the first clone existed to delete');
			assert.strictEqual(calls.update.length, 0, 'no body updates ran');
		});

		test('verifies the source org against sourceOrgId', async () => {
			const { deps } = makeCloneDeps({ [A]: tmpl(A) });
			await assert.rejects(
				() => runBundleClone({ orgId: 'tgt-org', rootTemplateId: A, sourceOrgId: 'wrong' }, makeCtx(), deps),
				/is in org src-org, not wrong/,
			);
		});
	});

	suite('defaultTemplateCloneDeps (production SDK glue)', () => {
		const update = {
			id: 'x',
			body: 'b',
			contentType: 'text',
			language: 'jinja',
			context: null,
			cloneOverrides: null,
			description: null,
		};

		test('createTemplate returns the minted id', async () => {
			const { session, wrapper } = createMockSession({ profile: { org: { id: 'tgt', name: 'T' } } });
			wrapper.when('createTemplateMinimal', { data: { template: { id: 'c1', name: 'X' } } });
			const r = await defaultTemplateCloneDeps.createTemplate(session, 'X', 'tgt');
			assert.strictEqual(r.id, 'c1');
		});

		test('createTemplate throws when the response has no template', async () => {
			const { session, wrapper } = createMockSession();
			wrapper.when('createTemplateMinimal', { data: { template: null } });
			await assert.rejects(
				() => defaultTemplateCloneDeps.createTemplate(session, 'X', 'tgt'),
				/returned no template/,
			);
		});

		test('updateTemplate succeeds and throws on a missing template', async () => {
			const ok = createMockSession();
			ok.wrapper.when('updateTemplate', { data: { template: { id: 'x' } } });
			await defaultTemplateCloneDeps.updateTemplate(ok.session, update);

			const bad = createMockSession();
			bad.wrapper.when('updateTemplate', { data: { template: null } });
			await assert.rejects(
				() => defaultTemplateCloneDeps.updateTemplate(bad.session, update),
				/returned no template/,
			);
		});

		test('deleteTemplate succeeds and throws on a null result', async () => {
			const ok = createMockSession();
			ok.wrapper.when('deleteTemplate', { data: { deleteTemplate: 'x' } });
			await defaultTemplateCloneDeps.deleteTemplate(ok.session, 'x');

			const bad = createMockSession();
			bad.wrapper.when('deleteTemplate', { data: { deleteTemplate: null } });
			await assert.rejects(
				() => defaultTemplateCloneDeps.deleteTemplate(bad.session, 'x'),
				/rollback delete failed/,
			);
		});
	});
});
