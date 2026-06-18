import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { TemplateLink } from '@models';
import vscode from 'vscode';
import type { GraphqlToolDeps } from './graphqlTool';
import { toolOutputCache } from './toolOutputCache';
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
		workspaceToolsEnabled: () => true,
		...over,
	};
}

function templateLink(path: string, name: string): TemplateLink {
	return {
		uriString: vscode.Uri.file(path).toString(),
		org: { id: 'org-1', name: 'Test Org' },
		type: 'Template',
		template: { id: 'tpl-1', name } as TemplateLink['template'],
		bodyHash: 'hash',
	};
}

suite('Unit: workspaceTools', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('runToolRequests()', () => {
		test('list_template_links describes each link', async () => {
			const d = deps({ templateLinks: () => [templateLink('/ws/a.jinja', 'My Template')] });
			const [result] = await runToolRequests([{ tool: 'list_template_links', args: {} }], d);
			assert.strictEqual(result.output, 'a.jinja ← "My Template" (template tpl-1, org Test Org)');
		});

		test('list_template_links reports when nothing is linked', async () => {
			const [result] = await runToolRequests([{ tool: 'list_template_links', args: {} }], deps());
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.output, 'No files are linked to Rewst templates.');
		});

		test('workspace tools respect the ai.tools setting', async () => {
			const d = deps({ workspaceToolsEnabled: () => false });
			const [result] = await runToolRequests([{ tool: 'list_template_links', args: {} }], d);
			assert.strictEqual(result.ok, false);
			assert.ok(result.output.includes('rewst-buddy.ai.tools'));
		});

		test('a workflow tool is refused when the workflows capability is disabled', async () => {
			// The test config defaults to workspace-only, so "workflows" is off — a
			// directly-emitted buddy_workflow_* block must be gated at dispatch, not run.
			const [result] = await runToolRequests(
				[{ tool: 'buddy_workflow_get', args: { workflowId: 'w', orgId: 'o' } }],
				deps(),
			);
			assert.strictEqual(result.ok, false);
			assert.match(result.output, /Workflow tools are disabled/);
			assert.ok(result.output.includes('rewst-buddy.ai.tools'));
		});

		test('unknown tools fail with the available tool list', async () => {
			const [result] = await runToolRequests([{ tool: 'delete_everything', args: {} }], deps());
			assert.strictEqual(result.ok, false);
			assert.match(result.output, /Unknown tool "delete_everything"/);
			assert.match(result.output, /list_template_links/);
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

		test('caches oversized tool output and reads it back through buddy_result_read', async () => {
			toolOutputCache.clear();
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
			assert.match(result.output, /cached in memory as id "([0-9a-f]+)"/);
			assert.match(result.output, /buddy_result_read/);
			assert.doesNotMatch(result.output, /saved/i);
			const id = result.output.match(/cached in memory as id "([0-9a-f]+)"/)?.[1];
			assert.ok(id, 'result announces a cache id');

			const [read] = await runToolRequests([{ tool: 'buddy_result_read', args: { id, offset: 8_000 } }], deps());
			assert.strictEqual(read.ok, true);
			assert.match(read.output, /characters 8000–14000 of \d+/);
			assert.ok(read.output.includes('y'.repeat(100)), 'returns a slice of the cached text');
		});

		test('buddy_result_read reports an unknown cache id', async () => {
			toolOutputCache.clear();
			const [read] = await runToolRequests([{ tool: 'buddy_result_read', args: { id: 'nope' } }], deps());
			assert.strictEqual(read.ok, false);
			assert.match(read.output, /No cached tool result for id "nope"/);
		});

		test('reports progress per request', async () => {
			const labels: string[] = [];
			await runToolRequests([{ tool: 'list_template_links', args: {} }], deps(), label => labels.push(label));
			assert.deepStrictEqual(labels, ['Running list_template_links…']);
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
