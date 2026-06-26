import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { TemplateLink } from '@models';
import vscode from 'vscode';
import type { GraphqlToolDeps } from './graphqlTool';
import {
	buildWorkspaceOverview,
	createCachedWorkspaceOverview,
	runToolRequests,
	wireWorkspaceOverviewInvalidation,
	type WorkspaceToolDeps,
} from './workspaceTools';

const { suite, test, setup } = Mocha;

const folder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 };

function deps(over: Partial<WorkspaceToolDeps> = {}): WorkspaceToolDeps {
	return {
		readDirectory: async () => [],
		workspaceFolders: () => [folder],
		asRelativePath: uri => uri.path.replace(/^\/ws\//, ''),
		templateLinks: () => [],
		...over,
	};
}

function templateLink(path: string, name: string, id = 'tpl-1', orgName = 'Test Org'): TemplateLink {
	return {
		uriString: vscode.Uri.file(path).toString(),
		org: { id: 'org-1', name: orgName },
		type: 'Template',
		template: { id, name } as TemplateLink['template'],
		bodyHash: 'hash',
	};
}

suite('Unit: workspaceTools', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('runToolRequests()', () => {
		test('search_template_links describes each matching link', async () => {
			const d = deps({ templateLinks: () => [templateLink('/ws/a.jinja', 'My Template')] });
			const [result] = await runToolRequests([{ tool: 'search_template_links', args: {} }], d);
			assert.strictEqual(result.output, 'a.jinja ← "My Template" (template tpl-1, org Test Org)');
		});

		test('search_template_links reports when nothing is linked', async () => {
			const [result] = await runToolRequests([{ tool: 'search_template_links', args: {} }], deps());
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.output, 'No files are linked to Rewst templates.');
		});

		test('search_template_links filters by query across path, name, id, and org', async () => {
			const d = deps({
				templateLinks: () => [
					templateLink('/ws/alpha.jinja', 'Alpha', 'tpl-a', 'Acme'),
					templateLink('/ws/beta.jinja', 'Beta', 'tpl-b', 'Globex'),
				],
			});
			const byName = await runToolRequests([{ tool: 'search_template_links', args: { query: 'beta' } }], d);
			assert.strictEqual(byName[0].output, 'beta.jinja ← "Beta" (template tpl-b, org Globex)');

			const byOrg = await runToolRequests([{ tool: 'search_template_links', args: { query: 'acme' } }], d);
			assert.strictEqual(byOrg[0].output, 'alpha.jinja ← "Alpha" (template tpl-a, org Acme)');

			const byId = await runToolRequests([{ tool: 'search_template_links', args: { query: 'tpl-b' } }], d);
			assert.match(byId[0].output, /beta\.jinja/);
			assert.doesNotMatch(byId[0].output, /alpha\.jinja/);
		});

		test('search_template_links reports a query that matches nothing distinctly from nothing linked', async () => {
			const d = deps({ templateLinks: () => [templateLink('/ws/a.jinja', 'Alpha')] });
			const [result] = await runToolRequests([{ tool: 'search_template_links', args: { query: 'zzz' } }], d);
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.output, 'No linked files match "zzz".');
		});

		test('search_template_links caps results at the limit and notes the remainder', async () => {
			const links = ['c', 'a', 'b'].map(p => templateLink(`/ws/${p}.jinja`, p.toUpperCase(), `tpl-${p}`));
			const [result] = await runToolRequests(
				[{ tool: 'search_template_links', args: { limit: 2 } }],
				deps({ templateLinks: () => links }),
			);
			const lines = result.output.split('\n');
			// Sorted by path, capped at 2, with a remainder note.
			assert.match(lines[0], /^a\.jinja/);
			assert.match(lines[1], /^b\.jinja/);
			assert.match(result.output, /1 more not shown/);
			assert.doesNotMatch(result.output, /c\.jinja/);
		});

		test('unknown tools fail with the available tool list', async () => {
			const [result] = await runToolRequests([{ tool: 'delete_everything', args: {} }], deps());
			assert.strictEqual(result.ok, false);
			assert.match(result.output, /Unknown tool "delete_everything"/);
			assert.match(result.output, /search_template_links/);
			assert.match(result.output, /buddy_graphql/);
		});

		test('routes buddy_graphql through GraphQL deps', async () => {
			const calls: { query: string; variables?: Record<string, unknown> }[] = [];
			const graphqlDeps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					calls.push({ query, variables });
					return { data: { user: { id: 'u-1' } } };
				},
			};
			const [result] = await runToolRequests(
				[
					{
						tool: 'buddy_graphql',
						args: { query: 'query U($id: ID!) { user(id: $id) { id } }', variables: { id: 'u-1' } },
					},
				],
				deps(),
				undefined,
				graphqlDeps,
			);
			assert.strictEqual(result.ok, true);
			assert.match(result.output, /"u-1"/);
			assert.deepStrictEqual(calls, [
				{ query: 'query U($id: ID!) { user(id: $id) { id } }', variables: { id: 'u-1' } },
			]);
		});

		test('returns oversized tool output directly for the MCP boundary to truncate', async () => {
			const big = 'y'.repeat(20_000);
			const graphqlDeps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async () => ({ data: { big } }),
			};
			const [result] = await runToolRequests(
				[{ tool: 'buddy_graphql', args: { query: '{ big }' } }],
				deps(),
				undefined,
				graphqlDeps,
			);
			assert.strictEqual(result.ok, true);
			assert.ok(result.output.includes('y'.repeat(100)), 'raw output is preserved');
			assert.doesNotMatch(result.output, /buddy_result_read/);
			assert.doesNotMatch(result.output, /cached in memory/);
		});

		test('reports progress per request', async () => {
			const labels: string[] = [];
			await runToolRequests([{ tool: 'search_template_links', args: {} }], deps(), label => labels.push(label));
			assert.deepStrictEqual(labels, ['Running search_template_links…']);
		});
	});

	suite('buildWorkspaceOverview()', () => {
		test('returns undefined with no workspace folders', async () => {
			assert.strictEqual(await buildWorkspaceOverview(deps({ workspaceFolders: () => [] })), undefined);
		});

		test('summarizes top-level entries and linked template count', async () => {
			const d = deps({
				readDirectory: async () => [
					['src', vscode.FileType.Directory],
					['package.json', vscode.FileType.File],
					['.git', vscode.FileType.Directory],
					['node_modules', vscode.FileType.Directory],
				],
				templateLinks: () => [templateLink('/ws/a.jinja', 'T')],
			});
			const overview = await buildWorkspaceOverview(d);
			assert.ok(overview);
			assert.ok(overview.includes('Workspace root: /ws'));
			assert.ok(overview.includes('Workspace folder "ws": package.json, src/'));
			assert.ok(overview.includes('1 file(s) are linked to Rewst templates'));
			assert.ok(!overview.includes('.git'));
		});
	});

	suite('createCachedWorkspaceOverview()', () => {
		test('serves a cached value within the TTL instead of rebuilding', async () => {
			let builds = 0;
			let clock = 1000;
			const cache = createCachedWorkspaceOverview(
				async () => `overview-${++builds}`,
				30_000,
				() => clock,
			);

			assert.strictEqual(await cache.get(), 'overview-1');
			clock += 10_000; // still inside the TTL
			assert.strictEqual(await cache.get(), 'overview-1', 'second call within TTL is cached');
			assert.strictEqual(builds, 1, 'the underlying scan ran once');
		});

		test('rebuilds after the TTL elapses', async () => {
			let builds = 0;
			let clock = 1000;
			const cache = createCachedWorkspaceOverview(
				async () => `overview-${++builds}`,
				30_000,
				() => clock,
			);

			assert.strictEqual(await cache.get(), 'overview-1');
			clock += 30_001; // past the TTL
			assert.strictEqual(await cache.get(), 'overview-2');
			assert.strictEqual(builds, 2);
		});

		test('invalidate() forces a rebuild on the next get, even within the TTL', async () => {
			let builds = 0;
			const cache = createCachedWorkspaceOverview(
				async () => `overview-${++builds}`,
				30_000,
				() => 1000, // clock frozen inside the TTL
			);

			assert.strictEqual(await cache.get(), 'overview-1');
			assert.strictEqual(await cache.get(), 'overview-1', 'cached while fresh');
			cache.invalidate();
			assert.strictEqual(await cache.get(), 'overview-2', 'rebuilt after invalidation');
			assert.strictEqual(builds, 2);
		});

		test('a scan invalidated mid-flight is not re-cached', async () => {
			let builds = 0;
			const releases: ((value: string) => void)[] = [];
			const cache = createCachedWorkspaceOverview(
				() => {
					builds++;
					return new Promise<string>(resolve => releases.push(resolve));
				},
				30_000,
				() => 1000, // clock frozen inside the TTL
			);

			const first = cache.get(); // scan #1 starts
			cache.invalidate(); // a file changed while scan #1 was in flight
			releases[0]('stale');
			assert.strictEqual(await first, 'stale', 'the original caller still receives its result');

			const second = cache.get(); // must rebuild, not serve the pre-invalidation scan
			releases[1]('fresh');
			assert.strictEqual(await second, 'fresh');
			assert.strictEqual(builds, 2, 'the stale scan was discarded, not re-cached');
		});

		test('concurrent callers share a single in-flight scan', async () => {
			let builds = 0;
			let release!: (value: string) => void;
			const cache = createCachedWorkspaceOverview(
				() => {
					builds++;
					return new Promise<string>(resolve => {
						release = resolve;
					});
				},
				30_000,
				() => 1000,
			);

			const first = cache.get();
			const second = cache.get();
			release('overview');
			assert.strictEqual(await first, 'overview');
			assert.strictEqual(await second, 'overview');
			assert.strictEqual(builds, 1, 'only one scan started for the overlapping calls');
		});
	});

	suite('wireWorkspaceOverviewInvalidation()', () => {
		test('registers file/link/folder watchers and disposes cleanly', () => {
			// Exercises the real VS Code watcher API (createFileSystemWatcher +
			// RelativePattern) so a misuse surfaces here rather than at runtime.
			const wiring = wireWorkspaceOverviewInvalidation(() => {}, [folder]);
			assert.strictEqual(typeof wiring.dispose, 'function');
			assert.doesNotThrow(() => wiring.dispose());
		});

		test('no workspace folders still wires link/folder invalidation without throwing', () => {
			const wiring = wireWorkspaceOverviewInvalidation(() => {}, []);
			assert.doesNotThrow(() => wiring.dispose());
		});
	});
});
