/**
 * Unit tests for JinjaPreviewContext pure helpers — context merge, execution
 * QuickPick item building, and cache-key equality with buddy_workflow_search.
 *
 * Runner: mocha extension-host.
 */

import { initTestEnvironment, stub } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import type { GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import type { ExecutionRow } from '../workflow/executions';
import {
	buildExecutionQuickPickItems,
	mergeExecutionContext,
	pickJinjaExecutionContext,
	type JinjaPreviewOrgPickItem,
} from './JinjaPreviewContext';

const { suite, test, setup } = Mocha;

type FakeExecuteHandler = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

function makeDeps(handler: FakeExecuteHandler, cacheScope?: string): GraphqlToolDeps {
	return {
		isEnabled: () => true,
		confirmMutation: async () => true,
		execute: handler as GraphqlToolDeps['execute'],
		cacheScope,
	};
}

suite('Unit: JinjaPreviewContext', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('mergeExecutionContext()', () => {
		test('merges snapshots in order, later keys winning', async () => {
			const deps = makeDeps(async query => {
				if (query.includes('RewstBuddyExecutionContexts')) {
					return {
						data: { workflowExecutionContexts: [{ a: 1 }, { a: 2, b: 3 }] },
					};
				}
				return { data: {} };
			});

			const merged = await mergeExecutionContext(deps, 'exec-1');

			assert.deepStrictEqual(merged, { a: 2, b: 3 });
		});

		test('throws when the execution has no context snapshots', async () => {
			const deps = makeDeps(async query => {
				if (query.includes('RewstBuddyExecutionContexts')) {
					return { data: { workflowExecutionContexts: [] } };
				}
				return { data: {} };
			});

			await assert.rejects(() => mergeExecutionContext(deps, 'exec-empty'), /no context/i);
		});
	});

	suite('buildExecutionQuickPickItems()', () => {
		test('formats id/status/createdAt into labels, newest first', () => {
			const rows: ExecutionRow[] = [
				{ id: 'exec-old', status: 'succeeded', createdAt: '1000', numSuccessfulTasks: 3 },
				{ id: 'exec-new', status: 'failed', createdAt: '3000', numSuccessfulTasks: 1 },
				{ id: 'exec-mid', status: 'succeeded', createdAt: '2000', numSuccessfulTasks: 2 },
			];

			const items = buildExecutionQuickPickItems(rows);

			// Should be sorted newest first
			assert.strictEqual(items.length, 3);
			assert.ok(
				items[0].label.includes('exec-new') ||
					items[0].detail?.includes('exec-new') ||
					items[0].description?.includes('exec-new'),
				'newest execution should be first',
			);
			assert.ok(
				items[2].label.includes('exec-old') ||
					items[2].detail?.includes('exec-old') ||
					items[2].description?.includes('exec-old'),
				'oldest execution should be last',
			);
			// Each item should surface status and id somewhere
			for (const item of items) {
				const text = [item.label, item.detail, item.description].filter(Boolean).join(' ');
				assert.ok(
					text.includes('succeeded') || text.includes('failed'),
					`item should include status, got: ${text}`,
				);
			}
		});
	});

	suite('pickJinjaExecutionContext()', () => {
		const orgItems: JinjaPreviewOrgPickItem[] = [
			{ label: 'Org One', description: 'org-1', orgId: 'org-1', orgName: 'Org One' },
			{ label: 'Org Two', description: 'org-2', orgId: 'org-2', orgName: 'Org Two' },
		];

		test('paginates workflows for the selected org before showing the workflow picker', async () => {
			const workflowOffsets: unknown[] = [];
			let workflowItemCount = 0;
			const firstPage = Array.from({ length: 500 }, (_, i) => ({
				id: `wf-page-1-${i}`,
				name: `Workflow ${i}`,
				orgId: 'org-1',
			}));
			const deps = makeDeps(async (query, variables) => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					workflowOffsets.push(variables?.offset);
					return {
						data: {
							workflows:
								variables?.offset === 0
									? firstPage
									: [{ id: 'wf-page-2', name: 'Workflow Page Two', orgId: 'org-1' }],
						},
					};
				}
				if (query.includes('RewstBuddyExecutions')) {
					assert.deepStrictEqual(variables?.where, { workflowId: 'wf-page-2', orgId: 'org-1' });
					return {
						data: {
							workflowExecutions: [
								{ id: 'exec-page-2', status: 'succeeded', createdAt: '1000', numSuccessfulTasks: 1 },
							],
						},
					};
				}
				return { data: {} };
			}, 'session-1');
			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				const resolved = (await items) as readonly (vscode.QuickPickItem & {
					orgId?: string;
					workflowId?: string;
					executionId?: string;
				})[];
				if (title.includes('Org')) return resolved[0];
				if (title.includes('Workflow')) {
					workflowItemCount = resolved.length;
					return resolved.find(item => item.workflowId === 'wf-page-2');
				}
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				const entry = await pickJinjaExecutionContext({
					orgItems: [orgItems[0]],
					depsForOrg: async () => deps,
					initialOrgId: 'org-1',
				});

				assert.deepStrictEqual(workflowOffsets, [0, 500]);
				assert.strictEqual(workflowItemCount, 501);
				assert.strictEqual(entry?.workflowId, 'wf-page-2');
				assert.strictEqual(entry?.executionId, 'exec-page-2');
			} finally {
				restoreQuickPick();
			}
		});

		test('shows the org picker before loading workflows, then queries only the selected org', async () => {
			const events: string[] = [];
			const deps = makeDeps(async (query, variables) => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					events.push(`workflow-query:${variables?.orgId ?? ''}`);
					return {
						data: {
							workflows: [
								{
									id: 'wf-2',
									name: 'Workflow Two',
									orgId: 'org-2',
								},
							],
						},
					};
				}
				if (query.includes('RewstBuddyExecutions')) {
					events.push('executions-query');
					return {
						data: {
							workflowExecutions: [
								{ id: 'exec-1', status: 'succeeded', createdAt: '1000', numSuccessfulTasks: 1 },
							],
						},
					};
				}
				return { data: {} };
			}, 'session-1');
			const depsForOrg = async (orgId: string) => {
				events.push(`deps-for-org:${orgId}`);
				return deps;
			};
			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				events.push(`show:${title}`);
				const resolved = (await items) as readonly (vscode.QuickPickItem & {
					orgId?: string;
					workflowId?: string;
					executionId?: string;
				})[];
				if (title.includes('Org')) return resolved.find(item => item.orgId === 'org-2');
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				const entry = await pickJinjaExecutionContext({ orgItems, depsForOrg, initialOrgId: 'org-1' });

				assert.deepStrictEqual(events, [
					'show:Jinja Preview: Pick Org',
					'deps-for-org:org-2',
					'workflow-query:org-2',
					'show:Jinja Preview: Pick Workflow',
					'executions-query',
					'show:Jinja Preview: Pick Execution',
				]);
				assert.strictEqual(entry?.orgId, 'org-2');
				assert.strictEqual(entry?.workflowId, 'wf-2');
			} finally {
				restoreQuickPick();
			}
		});

		test('lists workflows from the selected org instead of the template org', async () => {
			let workflowItems: readonly (vscode.QuickPickItem & { workflowId?: string })[] = [];
			const deps = makeDeps(async (query, variables) => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					assert.strictEqual(variables?.orgId, 'org-2');
					return {
						data: {
							workflows: [
								{
									id: 'wf-current-scope',
									name: 'Current Scope Workflow',
									orgId: 'org-2',
								},
							],
						},
					};
				}
				if (query.includes('RewstBuddyExecutions')) {
					assert.deepStrictEqual(
						variables?.where,
						{ workflowId: 'wf-current-scope', orgId: 'org-2' },
						'execution lookup should use the picked workflow org',
					);
					return {
						data: {
							workflowExecutions: [
								{ id: 'exec-current', status: 'succeeded', createdAt: '1000', numSuccessfulTasks: 1 },
							],
						},
					};
				}
				return { data: {} };
			}, 'session-1');
			const depsForOrg = async () => deps;
			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				const resolved = (await items) as readonly (vscode.QuickPickItem & {
					orgId?: string;
					workflowId?: string;
					executionId?: string;
				})[];
				if (title.includes('Org')) return resolved.find(item => item.orgId === 'org-2');
				if (!workflowItems.length) {
					workflowItems = resolved;
					return resolved[0];
				}
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				const entry = await pickJinjaExecutionContext({ orgItems, depsForOrg, initialOrgId: 'org-1' });

				assert.deepStrictEqual(
					workflowItems.map(item => item.workflowId),
					['wf-current-scope'],
					'picker should only show workflows from the selected org',
				);
				assert.strictEqual(entry?.workflowId, 'wf-current-scope');
				assert.strictEqual(entry?.orgId, 'org-2');
				assert.strictEqual(entry?.executionId, 'exec-current');
			} finally {
				restoreQuickPick();
			}
		});

		test('falls back to a workflowId-only execution lookup when the root-scoped query is empty', async () => {
			const executionWheres: unknown[] = [];
			const deps = makeDeps(async (query, variables) => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					return { data: { workflows: [{ id: 'wf-sub', name: 'Sub Workflow', orgId: 'org-1' }] } };
				}
				if (query.includes('RewstBuddyExecutions')) {
					executionWheres.push(variables?.where);
					// Root-scoped (workflowId+orgId) query is empty; this workflow only ever
					// ran as a sub-workflow, so its executions live under a different orgId.
					if ((variables?.where as { orgId?: string })?.orgId) {
						return { data: { workflowExecutions: [] } };
					}
					return {
						data: {
							workflowExecutions: [
								{ id: 'exec-sub-run', status: 'succeeded', createdAt: '1000', numSuccessfulTasks: 1 },
							],
						},
					};
				}
				return { data: {} };
			}, 'session-1');
			const depsForOrg = async () => deps;
			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				const resolved = (await items) as readonly (vscode.QuickPickItem & {
					orgId?: string;
					workflowId?: string;
					executionId?: string;
				})[];
				if (title.includes('Org')) return resolved[0];
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				const entry = await pickJinjaExecutionContext({
					orgItems: [orgItems[0]],
					depsForOrg,
					initialOrgId: 'org-1',
				});

				assert.deepStrictEqual(executionWheres, [
					{ workflowId: 'wf-sub', orgId: 'org-1' },
					{ workflowId: 'wf-sub' },
				]);
				assert.strictEqual(entry?.executionId, 'exec-sub-run');
			} finally {
				restoreQuickPick();
			}
		});

		test('throws with context when the executions query returns a GraphQL error', async () => {
			const deps = makeDeps(async query => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					return { data: { workflows: [{ id: 'wf-1', name: 'Workflow', orgId: 'org-1' }] } };
				}
				if (query.includes('RewstBuddyExecutions')) {
					return { errors: [{ message: 'boom' }] };
				}
				return { data: {} };
			}, 'session-1');
			const depsForOrg = async () => deps;
			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				const resolved = (await items) as readonly (vscode.QuickPickItem & {
					orgId?: string;
					workflowId?: string;
				})[];
				if (title.includes('Org')) return resolved[0];
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				await assert.rejects(
					() =>
						pickJinjaExecutionContext({
							orgItems: [orgItems[0]],
							depsForOrg,
							initialOrgId: 'org-1',
						}),
					/Failed to list executions: boom/,
				);
			} finally {
				restoreQuickPick();
			}
		});

		test('uses the selected fallback execution org for the saved preview context', async () => {
			const deps = makeDeps(async (query, variables) => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					return { data: { workflows: [{ id: 'wf-sub', name: 'Sub Workflow', orgId: 'workflow-org' }] } };
				}
				if (query.includes('RewstBuddyExecutions')) {
					if ((variables?.where as { orgId?: string })?.orgId) {
						return { data: { workflowExecutions: [] } };
					}
					return {
						data: {
							workflowExecutions: [
								{
									id: 'exec-sub-run',
									status: 'succeeded',
									createdAt: '1000',
									numSuccessfulTasks: 1,
									orgId: 'caller-org',
								},
							],
						},
					};
				}
				return { data: {} };
			}, 'session-1');
			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				const resolved = (await items) as readonly (vscode.QuickPickItem & {
					orgId?: string;
					workflowId?: string;
					executionId?: string;
				})[];
				if (title.includes('Org')) return resolved[0];
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				const entry = await pickJinjaExecutionContext({
					orgItems: [{ label: 'Workflow Org', orgId: 'workflow-org', orgName: 'Workflow Org' }],
					depsForOrg: async () => deps,
					initialOrgId: 'workflow-org',
				});

				assert.strictEqual(entry?.executionId, 'exec-sub-run');
				assert.strictEqual(entry?.orgId, 'caller-org');
			} finally {
				restoreQuickPick();
			}
		});

		test('keeps execution ids attached to their sorted picker rows', async () => {
			const deps = makeDeps(async query => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					return {
						data: {
							workflows: [
								{
									id: 'wf-1',
									name: 'Workflow One',
									orgId: 'org-1',
									organization: { id: 'org-1', name: 'Org One' },
								},
							],
						},
					};
				}
				if (query.includes('RewstBuddyExecutions')) {
					return {
						data: {
							workflowExecutions: [
								{ id: 'exec-old', status: 'succeeded', createdAt: '1000', numSuccessfulTasks: 1 },
								{ id: 'exec-new', status: 'failed', createdAt: '3000', numSuccessfulTasks: 1 },
							],
						},
					};
				}
				return { data: {} };
			}, 'session-1');
			const depsForOrg = async () => deps;
			let quickPickCall = 0;
			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				const resolved = (await items) as readonly (vscode.QuickPickItem & {
					orgId?: string;
					workflowId?: string;
					executionId?: string;
				})[];
				if (title.includes('Org')) return resolved[0];
				quickPickCall++;
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				const entry = await pickJinjaExecutionContext({
					orgItems: [orgItems[0]],
					depsForOrg,
					initialOrgId: 'org-1',
				});

				assert.strictEqual(quickPickCall, 2);
				assert.strictEqual(entry?.executionId, 'exec-new', 'selected newest row should keep its own id');
			} finally {
				restoreQuickPick();
			}
		});
	});
});
