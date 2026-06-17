import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { TemplateLink } from '@models';
import vscode from 'vscode';
import type { GraphqlToolDeps } from './graphqlTool';
import { buildWorkspaceOverview, runToolRequests, type WorkspaceToolDeps } from './workspaceTools';

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
});
