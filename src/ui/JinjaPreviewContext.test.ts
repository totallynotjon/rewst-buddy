/**
 * Unit tests for JinjaPreviewContext pure helpers — context merge, execution
 * QuickPick item building, and cache-key equality with buddy_workflow_search.
 *
 * Runner: mocha extension-host.
 */

import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import type { ExecutionRow } from '../workflow/executions';
import { workflowSearchCacheKey } from '../workflow/searchIndex';
import { WORKFLOW_SEARCH_TOOL_NAME } from '../workflow/specs';
import {
	buildExecutionQuickPickItems,
	mergeExecutionContext,
	workflowIndexCacheKeyForPicker,
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

	suite('workflowIndexCacheKeyForPicker()', () => {
		test('matches buddy_workflow_search cache key for the same deps.cacheScope', () => {
			const deps = makeDeps(async () => ({ data: {} }), 'org-scope-123');

			const pickerKey = workflowIndexCacheKeyForPicker(deps);
			const searchKey = workflowSearchCacheKey({ tool: WORKFLOW_SEARCH_TOOL_NAME, args: {} }, deps);

			assert.strictEqual(
				pickerKey,
				searchKey,
				'picker must share the same cache key as buddy_workflow_search so the warm index is reused',
			);
		});
	});
});
