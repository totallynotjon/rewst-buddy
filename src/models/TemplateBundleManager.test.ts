import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { LinkManager, TemplateBundleManager, TemplateLink } from '@models';

const { suite, test, setup, teardown } = Mocha;

let counter = 0;
function uuid(): string {
	const hex = (++counter).toString(16).padStart(8, '0');
	return `${hex}-0000-0000-0000-000000000000`;
}

function makeLink(id: string, name: string, refs: string[] = []): TemplateLink {
	return {
		uriString: `file:///test/${id}.jinja`,
		org: { id: 'org-1', name: 'Test Org' },
		type: 'Template',
		template: { id, name, updatedAt: '' } as any,
		bodyHash: 'hash',
		referencedTemplateIds: refs,
	};
}

function bundleIds(orgIndex = 0): string[][] {
	const orgBundles = TemplateBundleManager.getOrgBundles();
	if (orgBundles.length === 0) return [];
	return orgBundles[orgIndex].bundles.map(b => b.members.map(m => m.template.id).sort());
}

function standaloneIds(orgIndex = 0): string[] {
	const orgBundles = TemplateBundleManager.getOrgBundles();
	if (orgBundles.length === 0) return [];
	return orgBundles[orgIndex].standalone.map(l => l.template.id).sort();
}

suite('Unit: TemplateBundleManager', () => {
	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		LinkManager.loaded = true; // prevent loadIfNotAlready from triggering save/load/event cycle
		TemplateBundleManager._resetForTesting();
	});

	teardown(() => {
		TemplateBundleManager._resetForTesting();
		LinkManager._resetForTesting();
	});

	suite('no links', () => {
		test('should produce empty results', async () => {
			await TemplateBundleManager.buildBundles();
			assert.deepStrictEqual(TemplateBundleManager.getOrgBundles(), []);
		});
	});

	suite('standalone templates', () => {
		test('should classify templates with no refs as standalone', async () => {
			const a = uuid(),
				b = uuid();
			LinkManager.addLink(makeLink(a, 'Alpha'));
			LinkManager.addLink(makeLink(b, 'Beta'));

			await TemplateBundleManager.buildBundles();

			assert.deepStrictEqual(bundleIds(), []);
			assert.deepStrictEqual(standaloneIds(), [a, b].sort());
		});
	});

	suite('simple chain (A -> B)', () => {
		test('should create one bundle with A as root', async () => {
			const a = uuid(),
				b = uuid();
			LinkManager.addLink(makeLink(a, 'Root', [b]));
			LinkManager.addLink(makeLink(b, 'Child'));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 1);
			assert.strictEqual(bundles[0].root.template.id, a);
			assert.deepStrictEqual(bundles[0].members.map(m => m.template.id).sort(), [a, b].sort());
			assert.deepStrictEqual(standaloneIds(), []);
		});
	});

	suite('deep chain (A -> B -> C -> D -> E)', () => {
		test('should collect all transitive descendants', async () => {
			const [a, b, c, d, e] = [uuid(), uuid(), uuid(), uuid(), uuid()];
			LinkManager.addLink(makeLink(a, 'L1', [b]));
			LinkManager.addLink(makeLink(b, 'L2', [c]));
			LinkManager.addLink(makeLink(c, 'L3', [d]));
			LinkManager.addLink(makeLink(d, 'L4', [e]));
			LinkManager.addLink(makeLink(e, 'L5'));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 1);
			assert.strictEqual(bundles[0].root.template.id, a);
			assert.strictEqual(bundles[0].members.length, 5);
		});
	});

	suite('diamond (A -> B, A -> C, B -> D, C -> D)', () => {
		test('should produce one bundle containing all nodes', async () => {
			const [a, b, c, d] = [uuid(), uuid(), uuid(), uuid()];
			LinkManager.addLink(makeLink(a, 'Root', [b, c]));
			LinkManager.addLink(makeLink(b, 'Left', [d]));
			LinkManager.addLink(makeLink(c, 'Right', [d]));
			LinkManager.addLink(makeLink(d, 'Leaf'));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 1);
			assert.strictEqual(bundles[0].members.length, 4);
		});
	});

	suite('shared child (A -> C, B -> C)', () => {
		test('shared template appears in both bundles', async () => {
			const [a, b, c] = [uuid(), uuid(), uuid()];
			LinkManager.addLink(makeLink(a, 'Root1', [c]));
			LinkManager.addLink(makeLink(b, 'Root2', [c]));
			LinkManager.addLink(makeLink(c, 'Shared'));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 2);

			for (const bundle of bundles) {
				const memberIds = bundle.members.map(m => m.template.id);
				assert.ok(memberIds.includes(c), `bundle ${bundle.displayName} should contain shared child`);
			}
			assert.deepStrictEqual(standaloneIds(), []);
		});
	});

	suite('simple cycle (A -> B -> A)', () => {
		test('should form a single bundle from the cycle', async () => {
			const [a, b] = [uuid(), uuid()];
			LinkManager.addLink(makeLink(a, 'CycleA', [b]));
			LinkManager.addLink(makeLink(b, 'CycleB', [a]));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 1);
			assert.strictEqual(bundles[0].members.length, 2);
			assert.deepStrictEqual(standaloneIds(), []);
		});
	});

	suite('three-node cycle (A -> B -> C -> A)', () => {
		test('should form a single bundle', async () => {
			const [a, b, c] = [uuid(), uuid(), uuid()];
			LinkManager.addLink(makeLink(a, 'A', [b]));
			LinkManager.addLink(makeLink(b, 'B', [c]));
			LinkManager.addLink(makeLink(c, 'C', [a]));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 1);
			assert.strictEqual(bundles[0].members.length, 3);
		});
	});

	suite('cycle with tail (A -> B -> C -> B)', () => {
		test('A is root, B and C are cycle members in its bundle', async () => {
			const [a, b, c] = [uuid(), uuid(), uuid()];
			LinkManager.addLink(makeLink(a, 'Root', [b]));
			LinkManager.addLink(makeLink(b, 'CycleStart', [c]));
			LinkManager.addLink(makeLink(c, 'CycleEnd', [b]));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 1);
			assert.strictEqual(bundles[0].root.template.id, a);
			assert.strictEqual(bundles[0].members.length, 3);
		});
	});

	suite('refs to unknown templates are ignored', () => {
		test('should not crash on refs to templates not linked locally', async () => {
			const a = uuid();
			const unknown = uuid();
			LinkManager.addLink(makeLink(a, 'Local', [unknown]));

			await TemplateBundleManager.buildBundles();

			assert.deepStrictEqual(bundleIds(), []);
			assert.deepStrictEqual(standaloneIds(), [a]);
		});
	});

	suite('mixed standalone and bundles', () => {
		test('should correctly separate bundled and standalone', async () => {
			const [a, b, c, d] = [uuid(), uuid(), uuid(), uuid()];
			LinkManager.addLink(makeLink(a, 'Root', [b]));
			LinkManager.addLink(makeLink(b, 'Child'));
			LinkManager.addLink(makeLink(c, 'Standalone1'));
			LinkManager.addLink(makeLink(d, 'Standalone2'));

			await TemplateBundleManager.buildBundles();

			const org = TemplateBundleManager.getOrgBundles()[0];
			assert.strictEqual(org.bundles.length, 1);
			assert.strictEqual(org.standalone.length, 2);
		});
	});

	suite('display name collision', () => {
		test('should disambiguate bundles with the same root name', async () => {
			const [a1, a1child, a2, a2child] = [uuid(), uuid(), uuid(), uuid()];
			LinkManager.addLink(makeLink(a1, 'SameName', [a1child]));
			LinkManager.addLink(makeLink(a1child, 'Child1'));
			LinkManager.addLink(makeLink(a2, 'SameName', [a2child]));
			LinkManager.addLink(makeLink(a2child, 'Child2'));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 2);
			assert.notStrictEqual(bundles[0].displayName, bundles[1].displayName);
			assert.ok(bundles[0].displayName.includes('SameName'));
			assert.ok(bundles[1].displayName.includes('SameName'));
		});
	});

	suite('multiple orgs', () => {
		test('should produce separate OrgBundles per org', async () => {
			const [a, b] = [uuid(), uuid()];
			const link1 = makeLink(a, 'OrgOneTemplate');
			link1.org = { id: 'org-1', name: 'Org One' };
			const link2 = makeLink(b, 'OrgTwoTemplate');
			link2.org = { id: 'org-2', name: 'Org Two' };

			LinkManager.addLink(link1);
			LinkManager.addLink(link2);

			await TemplateBundleManager.buildBundles();

			const orgBundles = TemplateBundleManager.getOrgBundles();
			assert.strictEqual(orgBundles.length, 2);
			const orgIds = orgBundles.map(ob => ob.org.id).sort();
			assert.deepStrictEqual(orgIds, ['org-1', 'org-2']);
		});
	});

	suite('wide tree (root -> 10 children)', () => {
		test('should collect all children in one bundle', async () => {
			const root = uuid();
			const children = Array.from({ length: 10 }, () => uuid());

			LinkManager.addLink(makeLink(root, 'WideRoot', children));
			for (let i = 0; i < children.length; i++) {
				LinkManager.addLink(makeLink(children[i], `Child${i}`));
			}

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 1);
			assert.strictEqual(bundles[0].members.length, 11);
		});
	});

	suite('deep chain of 20 nodes', () => {
		test('should handle deeply nested chains', async () => {
			const ids = Array.from({ length: 20 }, () => uuid());
			for (let i = 0; i < ids.length; i++) {
				const refs = i < ids.length - 1 ? [ids[i + 1]] : [];
				LinkManager.addLink(makeLink(ids[i], `Node${i}`, refs));
			}

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 1);
			assert.strictEqual(bundles[0].root.template.id, ids[0]);
			assert.strictEqual(bundles[0].members.length, 20);
		});
	});

	suite('self-referencing template', () => {
		test('should handle a template that references itself', async () => {
			const a = uuid();
			LinkManager.addLink(makeLink(a, 'SelfRef', [a]));

			await TemplateBundleManager.buildBundles();

			const org = TemplateBundleManager.getOrgBundles()[0];
			// Self-reference means outgoing > 0 and referenced, so it's a cycle bundle
			assert.strictEqual(org.bundles.length, 1);
			assert.strictEqual(org.bundles[0].members.length, 1);
			assert.strictEqual(org.standalone.length, 0);
		});
	});

	suite('two separate bundles', () => {
		test('independent trees produce separate bundles', async () => {
			const [a, b, c, d] = [uuid(), uuid(), uuid(), uuid()];
			LinkManager.addLink(makeLink(a, 'Tree1Root', [b]));
			LinkManager.addLink(makeLink(b, 'Tree1Child'));
			LinkManager.addLink(makeLink(c, 'Tree2Root', [d]));
			LinkManager.addLink(makeLink(d, 'Tree2Child'));

			await TemplateBundleManager.buildBundles();

			const bundles = TemplateBundleManager.getOrgBundles()[0].bundles;
			assert.strictEqual(bundles.length, 2);

			const allMemberIds = bundles.flatMap(b => b.members.map(m => m.template.id));
			assert.ok(allMemberIds.includes(a));
			assert.ok(allMemberIds.includes(b));
			assert.ok(allMemberIds.includes(c));
			assert.ok(allMemberIds.includes(d));
		});
	});

	suite('error state', () => {
		test('should clear error after successful build', async () => {
			const a = uuid();
			LinkManager.addLink(makeLink(a, 'Test'));

			await TemplateBundleManager.buildBundles();

			assert.strictEqual(TemplateBundleManager.getError(), undefined);
		});
	});
});
