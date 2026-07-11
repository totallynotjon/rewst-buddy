import { TemplateBundleManager, type OrgBundles, type TemplateBundle, type TemplateLink } from '@models';
import { SessionManager, type SessionProfile } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { BundleTreeDataProvider } from './BundleTreeDataProvider';
import { SessionTreeDataProvider, SessionTreeItem } from './SessionTreeDataProvider';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

function stub<T extends object, K extends keyof T>(object: T, key: K, value: T[K]): Restore {
	const original = object[key];
	Object.defineProperty(object, key, { configurable: true, writable: true, value });
	return {
		restore() {
			Object.defineProperty(object, key, { configurable: true, writable: true, value: original });
		},
	};
}

function sessionProfile(userId: string, overrides: Partial<SessionProfile> = {}): SessionProfile {
	const { session } = createMockSession();
	return {
		...session.profile,
		label: `User ${userId}`,
		user: { ...session.profile.user, id: userId },
		...overrides,
	};
}

function templateLink(id: string, name: string, orgId = 'org-1'): TemplateLink {
	return {
		type: 'Template',
		uriString: `file:///workspace/${id}.jinja`,
		org: { id: orgId, name: `Org ${orgId}` },
		template: { id, name, updatedAt: '1' } as TemplateLink['template'],
		bodyHash: 'hash',
		referencedTemplateIds: [],
	};
}

function orgBundles(orgId: string, bundles: TemplateBundle[] = [], standalone: TemplateLink[] = []): OrgBundles {
	return { org: { id: orgId, name: `Org ${orgId}` }, bundles, standalone };
}

suite('Unit: tree data providers', () => {
	const restores: Restore[] = [];
	const disposables: vscode.Disposable[] = [];

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		TemplateBundleManager._resetForTesting();
	});

	teardown(() => {
		while (disposables.length) disposables.pop()!.dispose();
		while (restores.length) restores.pop()!.restore();
		SessionManager._resetForTesting();
		TemplateBundleManager._resetForTesting();
	});

	suite('SessionTreeDataProvider', () => {
		test('starts empty and has no children beneath session leaves', async () => {
			const provider = new SessionTreeDataProvider();
			disposables.push(provider);

			assert.deepStrictEqual(await provider.getChildren(), []);
			const leaf = new SessionTreeItem(sessionProfile('one'), true, vscode.TreeItemCollapsibleState.None);
			assert.deepStrictEqual(await provider.getChildren(leaf), []);
		});

		test('renders active and expired profiles from the latest session-change snapshot', async () => {
			const active = sessionProfile('active-user', {
				label: 'Active Label',
				region: { name: 'Europe', cookieName: 'eu', graphqlUrl: 'https://eu/graphql', loginUrl: 'https://eu' },
				org: { id: 'org-a', name: 'Active Org' },
				allManagedOrgs: [
					{ id: 'org-a', name: 'Active Org' },
					{ id: 'org-child', name: 'Child' },
				],
			});
			const expired = sessionProfile('expired-user', { label: 'Expired Label' });
			const provider = new SessionTreeDataProvider();
			disposables.push(provider);

			provider.refresh({ type: 'saved', activeProfiles: [active], allProfiles: [active, expired] });
			const items = await provider.getChildren();

			assert.strictEqual(items.length, 2);
			assert.strictEqual(items[0].label, 'Active Label');
			assert.strictEqual(items[0].active, true);
			assert.strictEqual((items[0].iconPath as vscode.ThemeIcon).id, 'check');
			assert.strictEqual(items[0].description, 'Europe');
			assert.match((items[0].tooltip as vscode.MarkdownString).value, /Managed Orgs:\*\* 2/);
			assert.strictEqual(items[1].active, false);
			assert.strictEqual((items[1].iconPath as vscode.ThemeIcon).id, 'error');
			assert.match((items[1].tooltip as vscode.MarkdownString).value, /EXPIRED/);
		});

		test('matches active state by stable user id rather than profile object identity', async () => {
			const activeSnapshot = sessionProfile('same-user', { label: 'Active snapshot' });
			const knownSnapshot = sessionProfile('same-user', { label: 'Known snapshot' });
			const provider = new SessionTreeDataProvider();
			disposables.push(provider);

			provider.refresh({ type: 'saved', activeProfiles: [activeSnapshot], allProfiles: [knownSnapshot] });

			assert.strictEqual((await provider.getChildren())[0].active, true);
		});

		test('fires a tree change for explicit refreshes and returns tree items unchanged', async () => {
			const provider = new SessionTreeDataProvider();
			disposables.push(provider);
			let fires = 0;
			disposables.push(provider.onDidChangeTreeData(() => fires++));
			const item = new SessionTreeItem(sessionProfile('one'), true, vscode.TreeItemCollapsibleState.None);

			provider.refresh();

			assert.strictEqual(fires, 1);
			assert.strictEqual(provider.getTreeItem(item), item);
		});
	});

	suite('BundleTreeDataProvider', () => {
		function setManagerState(value: OrgBundles[], error?: string): void {
			restores.push(
				stub(
					TemplateBundleManager,
					'getOrgBundles',
					(() => value) as typeof TemplateBundleManager.getOrgBundles,
				),
			);
			restores.push(
				stub(TemplateBundleManager, 'getError', (() => error) as typeof TemplateBundleManager.getError),
			);
		}

		test('returns no roots for a clean empty bundle cache', () => {
			setManagerState([]);
			const provider = new BundleTreeDataProvider();
			disposables.push(provider);
			assert.deepStrictEqual(provider.getChildren(), []);
		});

		test('shows a build error instead of stale bundle data', () => {
			setManagerState([orgBundles('org-1', [], [templateLink('old', 'Old')])], 'disk read failed');
			const provider = new BundleTreeDataProvider();
			disposables.push(provider);

			const roots = provider.getChildren() as any[];
			assert.strictEqual(roots.length, 1);
			assert.strictEqual(roots[0].kind, 'error');
			const item = provider.getTreeItem(roots[0]);
			assert.strictEqual(item.label, 'Failed to build bundles: disk read failed');
			assert.strictEqual(item.contextValue, 'bundleError');
			assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'error');
		});

		test('flattens a single organization and omits empty sections', () => {
			const standalone = templateLink('solo', 'Solo');
			setManagerState([orgBundles('org-1', [], [standalone])]);
			const provider = new BundleTreeDataProvider();
			disposables.push(provider);

			const roots = provider.getChildren() as any[];
			assert.deepStrictEqual(
				roots.map(root => root.kind),
				['section'],
			);
			const sectionItem = provider.getTreeItem(roots[0]);
			assert.strictEqual(sectionItem.label, 'Standalone (1)');
			assert.strictEqual(sectionItem.contextValue, 'bundleSection.standalone');
			assert.strictEqual((sectionItem.iconPath as vscode.ThemeIcon).id, 'file');
		});

		test('uses organization roots when templates span multiple organizations', () => {
			setManagerState([
				orgBundles('org-a', [], [templateLink('a', 'A', 'org-a')]),
				orgBundles('org-b', [], [templateLink('b', 'B', 'org-b')]),
			]);
			const provider = new BundleTreeDataProvider();
			disposables.push(provider);

			const roots = provider.getChildren() as any[];
			assert.deepStrictEqual(
				roots.map(root => root.kind),
				['org', 'org'],
			);
			assert.deepStrictEqual(
				roots.map(root => provider.getTreeItem(root).label),
				['Org org-a', 'Org org-b'],
			);
			assert.strictEqual(provider.getTreeItem(roots[0]).contextValue, 'bundleOrg');
		});

		test('expands bundle members into openable template leaves', () => {
			const root = templateLink('root', 'Root');
			const child = templateLink('child', 'Child');
			const bundle: TemplateBundle = {
				id: 'root',
				displayName: 'My Bundle',
				root,
				members: [root, child],
			};
			setManagerState([orgBundles('org-1', [bundle])]);
			const provider = new BundleTreeDataProvider();
			disposables.push(provider);

			const section = (provider.getChildren() as any[])[0];
			const bundleNode = (provider.getChildren(section) as any[])[0];
			const bundleItem = provider.getTreeItem(bundleNode);
			assert.strictEqual(bundleItem.label, 'My Bundle');
			assert.strictEqual(bundleItem.description, '2 templates');
			assert.match((bundleItem.tooltip as vscode.MarkdownString).value, /Root.*root/s);

			const leaves = provider.getChildren(bundleNode) as any[];
			assert.deepStrictEqual(
				leaves.map(leaf => leaf.kind),
				['template', 'template'],
			);
			const childItem = provider.getTreeItem(leaves[1]);
			assert.strictEqual(childItem.label, 'Child');
			assert.strictEqual(childItem.resourceUri?.toString(), child.uriString);
			assert.strictEqual(childItem.command?.command, 'vscode.open');
			assert.strictEqual((childItem.command?.arguments?.[0] as vscode.Uri).toString(), child.uriString);
			assert.deepStrictEqual(provider.getChildren(leaves[1]), []);
		});

		test('expands standalone sections directly into template leaves', () => {
			const links = [templateLink('a', 'A'), templateLink('b', 'B')];
			setManagerState([orgBundles('org-1', [], links)]);
			const provider = new BundleTreeDataProvider();
			disposables.push(provider);

			const section = (provider.getChildren() as any[])[0];
			const leaves = provider.getChildren(section) as any[];

			assert.deepStrictEqual(
				leaves.map(leaf => leaf.link),
				links,
			);
		});

		test('fires when the bundle manager publishes a new cache', () => {
			setManagerState([]);
			const provider = new BundleTreeDataProvider();
			disposables.push(provider);
			let fires = 0;
			disposables.push(provider.onDidChangeTreeData(() => fires++));

			(
				TemplateBundleManager as unknown as { bundlesChangedEmitter: vscode.EventEmitter<void> }
			).bundlesChangedEmitter.fire();

			assert.strictEqual(fires, 1);
		});
	});
});
