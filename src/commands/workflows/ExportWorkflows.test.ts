import { initTestEnvironment, stub } from '@test';
import { context } from '@global';
import { log } from '@utils';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { editorDataClient } from '../../backend/editorDataClient';
import type { WorkflowExportResult } from '../../../packages/mcp-server/src/capabilities/workflowExportCapability';
import { WORKFLOW_EXPORT_BOOTSTRAP_PAYLOAD } from '../../../packages/mcp-server/src/capabilities/workflowExportCapability';
import {
	MAX_WORKFLOW_CATALOG_CACHE_ENTRIES,
	MAX_WORKFLOW_EXPORT_BATCH_SIZE,
	WORKFLOW_CATALOG_CACHE_KEY,
	chooseWorkflowCatalog,
	exportWorkflowBatchToAvailablePath,
	pickDestination,
	persistWorkflowCatalog,
	readCachedWorkflowCatalog,
	runWorkflowExports,
	sanitizeWorkflowFilenamePart,
	separateWorkflowExportFilename,
	workflowExportOutputPath,
	workflowExportDestinationChoices,
	workflowQuickPickItems,
	writeCachedWorkflowCatalog,
	validateWorkflowExportPath,
	type ExportWorkflowChoice,
} from './ExportWorkflows';

const { suite, test, setup } = Mocha;

function workflow(id: string, name = id): ExportWorkflowChoice {
	return { id, name, orgId: 'org-1', orgName: 'Org One' };
}

function result(ids: string[], outputPath = `/exports/${ids.join('-')}.json`): WorkflowExportResult {
	return {
		status: 'saved',
		orgId: 'org-1',
		workflowIds: ids,
		recommendedFilename: 'export.json',
		outputPath,
		bytes: 100,
		version: 2,
		exportedAt: '2026-09-18T00:00:00.000Z',
		objectCount: ids.length,
		signingPresent: true,
	};
}

suite('Unit: ExportWorkflows helpers', () => {
	setup(() => initTestEnvironment());

	test('picker rows are searchable by org/id and distinguish duplicate names', () => {
		const items = workflowQuickPickItems(
			[
				{ id: 'wf-1', name: 'Onboarding', orgId: 'org-1' },
				{ id: 'wf-2', name: 'Onboarding', orgId: 'org-1' },
				{ id: 'wf-2', name: 'Duplicate row', orgId: 'org-1' },
				{ id: null, name: 'Missing id' },
			],
			{ id: 'org-1', name: 'Org One' },
		);

		assert.strictEqual(items.length, 2);
		assert.deepStrictEqual(
			items.map(item => item.label),
			['Onboarding', 'Onboarding'],
		);
		assert.match(items[0].description ?? '', /Org One.*org-1/);
		assert.strictEqual(items[0].detail, 'Workflow ID: wf-1');
		assert.strictEqual(items[1].detail, 'Workflow ID: wf-2');
	});

	test('picker rows trim values and fall back to the id for missing names or organizations', () => {
		const items = workflowQuickPickItems(
			[
				{ id: ' wf-1 ', name: '  ', orgId: ' org-9 ' },
				{ id: ' wf-1 ', name: 'Duplicate id' },
				{ id: ' wf-2 ', name: null, orgId: null },
			],
			{ id: 'org-1', name: 'Org One' },
		);

		assert.deepStrictEqual(
			items.map(item => item.workflow),
			[
				{ id: 'wf-1', name: 'wf-1', orgId: 'org-9', orgName: 'Org One' },
				{ id: 'wf-2', name: 'wf-2', orgId: 'org-1', orgName: 'Org One' },
			],
		);
	});

	test('destination choices allow a file only for bundled exports', () => {
		assert.deepStrictEqual(
			workflowExportDestinationChoices('bundle', '/exports').map(choice => choice.value),
			['default', 'folder', 'file', 'input'],
		);
		assert.deepStrictEqual(
			workflowExportDestinationChoices('separate', '/exports').map(choice => choice.value),
			['default', 'folder', 'input'],
		);
		assert.strictEqual(workflowExportDestinationChoices('separate', '/exports')[0].detail, '/exports');
		assert.match(workflowExportDestinationChoices('separate', '/exports')[2].detail ?? '', /existing folder/i);
		assert.deepStrictEqual(
			workflowExportDestinationChoices('bundle', '/exports', MAX_WORKFLOW_EXPORT_BATCH_SIZE + 1).map(
				choice => choice.value,
			),
			['default', 'folder', 'input'],
		);
	});

	test('workflow export bootstrap payload exposes the authoritative backend batch limit', () => {
		assert.strictEqual(WORKFLOW_EXPORT_BOOTSTRAP_PAYLOAD.maxWorkflowsPerExport, MAX_WORKFLOW_EXPORT_BATCH_SIZE);
	});

	test('workflow catalog cache writes and reads a matching session and organization entry', async () => {
		const entry = {
			sessionId: 'session-1',
			orgId: 'org-1',
			fetchedAt: '2026-09-18T12:00:00.000Z',
			workflows: [{ id: 'wf-1', name: 'One', orgId: 'org-1' }],
		};

		await writeCachedWorkflowCatalog(entry);

		assert.deepStrictEqual(readCachedWorkflowCatalog('session-1', 'org-1'), entry);
		assert.strictEqual(readCachedWorkflowCatalog('session-2', 'org-1'), undefined);
	});

	test('workflow catalog cache ignores malformed and mismatched entries', async () => {
		await context.globalState.update(WORKFLOW_CATALOG_CACHE_KEY, {
			entries: {
				['session-1\u0000org-1']: { sessionId: 'session-1', orgId: 'org-1', fetchedAt: 'not-a-date' },
				['session-1\u0000org-2']: {
					sessionId: 'other-session',
					orgId: 'org-2',
					fetchedAt: '2026-09-18T12:00:00.000Z',
					workflows: [],
				},
			},
		});

		assert.strictEqual(readCachedWorkflowCatalog('session-1', 'org-1'), undefined);
		assert.strictEqual(readCachedWorkflowCatalog('session-1', 'org-2'), undefined);
	});

	test('workflow catalog cache retains only the newest bounded set of entries', async () => {
		for (let index = 0; index <= MAX_WORKFLOW_CATALOG_CACHE_ENTRIES; index += 1) {
			await writeCachedWorkflowCatalog({
				sessionId: 'session-1',
				orgId: `org-${index}`,
				fetchedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
				workflows: [],
			});
		}

		const stored = context.globalState.get<{ entries: Record<string, unknown> }>(WORKFLOW_CATALOG_CACHE_KEY);
		assert.strictEqual(Object.keys(stored?.entries ?? {}).length, MAX_WORKFLOW_CATALOG_CACHE_ENTRIES);
		assert.strictEqual(readCachedWorkflowCatalog('session-1', 'org-0'), undefined);
		assert.ok(readCachedWorkflowCatalog('session-1', `org-${MAX_WORKFLOW_CATALOG_CACHE_ENTRIES}`));
	});

	test('catalog chooser returns a cached entry and does not fetch', async () => {
		const entry = {
			sessionId: 'session-1',
			orgId: 'org-1',
			fetchedAt: '2026-09-18T12:00:00.000Z',
			workflows: [],
		};
		await writeCachedWorkflowCatalog(entry);
		const restorePicker = stub(vscode.window, 'showQuickPick', (async (items: readonly { value: string }[]) =>
			items.find(item => item.value === 'cached')) as unknown as typeof vscode.window.showQuickPick);
		const restoreFetch = stub(editorDataClient, 'listExportWorkflows', (async () => {
			throw new Error('cache hit must not fetch');
		}) as typeof editorDataClient.listExportWorkflows);
		try {
			assert.deepStrictEqual(await chooseWorkflowCatalog('session-1', { id: 'org-1', name: 'Org One' }), entry);
		} finally {
			restoreFetch();
			restorePicker();
		}
	});

	test('catalog chooser stops when the cache-source prompt is dismissed', async () => {
		await writeCachedWorkflowCatalog({
			sessionId: 'session-1',
			orgId: 'org-1',
			fetchedAt: '2026-09-18T12:00:00.000Z',
			workflows: [],
		});
		const restorePicker = stub(
			vscode.window,
			'showQuickPick',
			(async () => undefined) as unknown as typeof vscode.window.showQuickPick,
		);
		try {
			assert.strictEqual(await chooseWorkflowCatalog('session-1', { id: 'org-1', name: 'Org One' }), undefined);
		} finally {
			restorePicker();
		}
	});

	test('catalog chooser refreshes a cached catalog from Rewst', async () => {
		await writeCachedWorkflowCatalog({
			sessionId: 'session-1',
			orgId: 'org-1',
			fetchedAt: '2026-09-18T12:00:00.000Z',
			workflows: [],
		});
		const cancellation = new vscode.CancellationTokenSource();
		const calls: { sessionId: string; orgId: string; aborted: boolean }[] = [];
		const restorePicker = stub(vscode.window, 'showQuickPick', (async (items: readonly { value: string }[]) =>
			items.find(item => item.value === 'refresh')) as unknown as typeof vscode.window.showQuickPick);
		const restoreProgress = stub(vscode.window, 'withProgress', (async (_options, task) =>
			task({ report: () => {} }, cancellation.token)) as typeof vscode.window.withProgress);
		const restoreFetch = stub(editorDataClient, 'listExportWorkflows', (async (input, options) => {
			calls.push({ ...input, aborted: options?.signal?.aborted ?? false });
			return [{ id: 'wf-fresh', name: 'Fresh', orgId: input.orgId }];
		}) as typeof editorDataClient.listExportWorkflows);
		try {
			const catalog = await chooseWorkflowCatalog('session-1', { id: 'org-1', name: 'Org One' });
			assert.deepStrictEqual(calls, [{ sessionId: 'session-1', orgId: 'org-1', aborted: false }]);
			assert.deepStrictEqual(catalog?.workflows, [{ id: 'wf-fresh', name: 'Fresh', orgId: 'org-1' }]);
		} finally {
			restoreFetch();
			restoreProgress();
			restorePicker();
			cancellation.dispose();
		}
	});

	test('catalog fetch aborts and returns no catalog when progress is cancelled', async () => {
		const cancellation = new vscode.CancellationTokenSource();
		let requestSignal: AbortSignal | undefined;
		const restoreProgress = stub(vscode.window, 'withProgress', (async (_options, task) => {
			const pending = task({ report: () => {} }, cancellation.token);
			cancellation.cancel();
			return pending;
		}) as typeof vscode.window.withProgress);
		const restoreFetch = stub(editorDataClient, 'listExportWorkflows', ((_input, options) => {
			requestSignal = options?.signal;
			return new Promise((_resolve, reject) => {
				requestSignal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
			});
		}) as typeof editorDataClient.listExportWorkflows);
		try {
			assert.strictEqual(await chooseWorkflowCatalog('session-1', { id: 'org-1', name: 'Org One' }), undefined);
			assert.strictEqual(requestSignal?.aborted, true);
			assert.strictEqual(readCachedWorkflowCatalog('session-1', 'org-1'), undefined);
		} finally {
			restoreFetch();
			restoreProgress();
			cancellation.dispose();
		}
	});

	test('catalog persistence logs rejected fire-and-forget writes', async () => {
		const warnings: unknown[][] = [];
		const restoreUpdate = stub(context.globalState, 'update', (async () => {
			throw new Error('storage unavailable');
		}) as typeof context.globalState.update);
		const restoreWarn = stub(log, 'warn', ((...args: unknown[]) => {
			warnings.push(args);
		}) as typeof log.warn);
		try {
			persistWorkflowCatalog({
				sessionId: 'session-1',
				orgId: 'org-1',
				fetchedAt: '2026-09-18T12:00:00.000Z',
				workflows: [],
			});
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(warnings.length, 1);
			assert.match(String(warnings[0][0]), /persist workflow export catalog cache/i);
		} finally {
			restoreWarn();
			restoreUpdate();
		}
	});

	test('webview refreshes stale catalogs, renders timestamp digit counts, and honors the host bundle limit', () => {
		class FakeElement {
			value = '';
			checked = false;
			disabled = false;
			hidden = false;
			textContent = '';
			className = '';
			innerHTML = '';
			onclick?: (event: { currentTarget: FakeElement; target: FakeElement }) => void;
			oninput?: (event: { target: FakeElement }) => void;
			onchange?: (event: { target: FakeElement }) => void;
			dataset: Record<string, string> = {};
			querySelectorAll(): FakeElement[] {
				return [];
			}
			focus(): void {}
		}
		const elements = new Map<string, FakeElement>();
		const element = (id: string): FakeElement => {
			let result = elements.get(id);
			if (!result) {
				result = new FakeElement();
				elements.set(id, result);
			}
			return result;
		};
		const modeRadios = ['separate', 'bundle'].map(value => Object.assign(new FakeElement(), { value }));
		const tagRadios = ['any', 'all'].map(value => Object.assign(new FakeElement(), { value }));
		let listener: ((event: { data: Record<string, unknown> }) => void) | undefined;
		let savedState: Record<string, unknown> | undefined;
		const posted: Record<string, unknown>[] = [];
		const source = readFileSync(join(process.cwd(), 'media/workflow-exporter/main.js'), 'utf8');
		vm.runInNewContext(source, {
			acquireVsCodeApi: () => ({
				getState: () => ({
					organizations: [{ id: 'org-1', name: 'Org One' }],
					selectedOrgId: 'org-1',
					workflows: [
						{ id: 'wf-1', name: 'Epoch seconds', updatedAt: '946728000' },
						{ id: 'wf-2', name: 'Epoch milliseconds', updatedAt: '946728000000' },
						{ id: 'wf-3', name: 'Invalid timestamp', updatedAt: 'not-a-date' },
					],
					visibleIds: ['wf-1', 'wf-2', 'wf-3'],
					selectedIds: ['wf-1', 'wf-2', 'wf-3'],
					tags: [],
					filters: { search: 'daily', tagIds: [], tagMatch: 'any' },
					mode: 'bundle',
				}),
				setState: (value: Record<string, unknown>) => {
					savedState = value;
				},
				postMessage: (message: Record<string, unknown>) => {
					posted.push(message);
				},
			}),
			document: {
				getElementById: element,
				querySelectorAll: (selector: string) => (selector.includes('tagMatch') ? tagRadios : modeRadios),
			},
			window: {
				addEventListener: (_type: string, handler: typeof listener) => {
					listener = handler;
				},
			},
			Set,
			Date,
			Number,
			String,
		});
		assert.strictEqual((element('workflowList').innerHTML.match(/2000/g) ?? []).length, 2);
		assert.match(element('workflowList').innerHTML, /edited unknown/);

		listener?.({
			data: {
				type: 'bootstrap',
				organizations: [{ id: 'org-1', name: 'Org One' }],
				catalogOrgId: 'org-other',
				maxWorkflowsPerExport: 2,
			},
		});
		assert.strictEqual(element('chooseFile').disabled, true);
		assert.strictEqual(savedState?.catalogOrgId, 'org-other');
		assert.ok(posted.some(message => message.type === 'loadCatalog' && message.orgId === 'org-1'));
		posted.length = 0;
		listener?.({ data: { type: 'catalogLoaded', orgId: 'org-1', workflows: [{ id: 'wf-1' }], tags: [] } });
		assert.strictEqual(posted.at(-1)?.type, 'applyFilters');
		assert.strictEqual((posted.at(-1)?.filters as { search?: string })?.search, 'daily');
		assert.strictEqual(savedState?.catalogOrgId, 'org-1');
		listener?.({ data: { type: 'catalogLoaded', orgId: 'org-1', workflows: [], tags: [] } });
		posted.length = 0;
		listener?.({
			data: {
				type: 'bootstrap',
				organizations: [{ id: 'org-1', name: 'Org One' }],
				catalogOrgId: 'org-1',
				maxWorkflowsPerExport: 2,
			},
		});
		assert.ok(posted.some(message => message.type === 'loadCatalog' && message.orgId === 'org-1'));
		posted.length = 0;
		listener?.({
			data: {
				type: 'bootstrap',
				organizations: [{ id: 'org-2', name: 'Org Two' }],
				catalogOrgId: null,
				maxWorkflowsPerExport: 2,
			},
		});
		assert.strictEqual(savedState?.selectedOrgId, 'org-2');
		assert.ok(posted.some(message => message.type === 'loadCatalog' && message.orgId === 'org-2'));
		assert.ok(!posted.some(message => message.type === 'loadCatalog' && message.orgId === 'org-1'));
		listener?.({ data: { type: 'organizations', organizations: [{ id: 'org-3', name: 'Org Three' }] } });
		assert.strictEqual(savedState?.selectedOrgId, '');
		assert.strictEqual(savedState?.catalogOrgId, '');
		assert.strictEqual((savedState?.workflows as unknown[])?.length, 0);
		assert.strictEqual((savedState?.visibleIds as unknown[])?.length, 0);
		assert.strictEqual((savedState?.selectedIds as unknown[])?.length, 0);
	});

	test('destination input enforces absolute paths and an existing folder for separate files', async () => {
		assert.strictEqual(
			await validateWorkflowExportPath('relative/path', 'bundle'),
			'Enter an absolute export path.',
		);
		assert.strictEqual(
			await validateWorkflowExportPath(process.execPath, 'separate'),
			'Choose an existing export folder for separate files.',
		);
		assert.strictEqual(
			await validateWorkflowExportPath(join(tmpdir(), 'rewst-buddy-export-path-does-not-exist'), 'bundle'),
			undefined,
		);
		assert.strictEqual(
			await validateWorkflowExportPath(
				join(tmpdir(), 'rewst-buddy-bundled-batches'),
				'bundle',
				MAX_WORKFLOW_EXPORT_BATCH_SIZE + 1,
			),
			'Choose an existing export folder for bundled batch files.',
		);
	});

	test('file destination rejects an existing save-dialog path and accepts a new name', async () => {
		const existingPath = join(process.cwd(), 'package.json');
		const newPath = join(tmpdir(), `rewst-workflows-export-${Date.now()}.json`);
		const savePaths = [existingPath, newPath];
		const warnings: string[] = [];
		const restorePicker = stub(vscode.window, 'showQuickPick', (async (items: readonly { value: string }[]) =>
			items.find(item => item.value === 'file')) as unknown as typeof vscode.window.showQuickPick);
		const restoreSave = stub(vscode.window, 'showSaveDialog', (async () => {
			const path = savePaths.shift();
			return path ? vscode.Uri.file(path) : undefined;
		}) as typeof vscode.window.showSaveDialog);
		const restoreWarning = stub(vscode.window, 'showWarningMessage', (async (message: string) => {
			warnings.push(message);
			return undefined;
		}) as typeof vscode.window.showWarningMessage);
		try {
			assert.deepStrictEqual(await pickDestination('bundle', tmpdir(), 1), {
				outputPath: newPath,
				kind: 'file',
			});
			assert.deepStrictEqual(warnings, ['Choose a new file name; workflow exports never overwrite files.']);
			assert.strictEqual(savePaths.length, 0);
		} finally {
			restoreWarning();
			restoreSave();
			restorePicker();
		}
	});

	test('filename mode preserves readable workflow names while remaining portable and collision-safe', () => {
		assert.strictEqual(sanitizeWorkflowFilenamePart('  Daily / User: Sync  '), 'Daily - User- Sync');
		assert.strictEqual(sanitizeWorkflowFilenamePart('Daily\u0000Sync\u001f\u007f'), 'DailySync');
		assert.strictEqual(
			separateWorkflowExportFilename(workflow('wf-123', 'Daily / User: Sync'), true),
			'Daily - User- Sync--wf-123.json',
		);
		assert.strictEqual(
			workflowExportOutputPath(
				{ kind: 'directory', outputPath: '/exports' },
				'/default',
				'separate',
				[workflow('wf-123', 'Daily / User: Sync')],
				0,
				1,
				true,
			),
			'/exports/Daily - User- Sync--wf-123.json',
		);
	});

	test('exports twice to the same folder with distinct unused output files', async () => {
		const existing = new Set<string>();
		const outputPaths: string[] = [];
		const request = {
			destination: { kind: 'directory' as const, outputPath: '/exports' },
			defaultDirectory: '/default',
			mode: 'bundle' as const,
			workflows: [workflow('wf-1')],
			batchIndex: 0,
			batchCount: 1,
		};
		const exportOnce = () =>
			exportWorkflowBatchToAvailablePath(
				request,
				async outputPath => {
					assert.ok(outputPath);
					existing.add(outputPath);
					outputPaths.push(outputPath);
					return result(['wf-1'], outputPath);
				},
				async path => existing.has(path),
			);

		await exportOnce();
		await exportOnce();

		assert.deepStrictEqual(outputPaths, [
			'/exports/rewst-workflows-batch-001-of-001.json',
			'/exports/rewst-workflows-batch-001-of-001-2.json',
		]);
	});

	test('bundle mode sends all selected ids in one backend operation', async () => {
		const calls: string[][] = [];
		const workflows = [workflow('wf-1'), workflow('wf-2')];
		const outcome = await runWorkflowExports(
			workflows,
			'bundle',
			async ids => {
				calls.push(ids);
				return result(ids);
			},
			new AbortController().signal,
		);

		assert.deepStrictEqual(calls, [['wf-1', 'wf-2']]);
		assert.deepStrictEqual(outcome.results[0].workflowIds, ['wf-1', 'wf-2']);
		assert.deepStrictEqual(outcome.failures, []);
		assert.strictEqual(outcome.cancelled, false);
	});

	test('separate mode continues after a failure and returns a useful partial summary shape', async () => {
		const calls: string[][] = [];
		const outcome = await runWorkflowExports(
			[workflow('wf-1', 'One'), workflow('wf-2', 'Two'), workflow('wf-3', 'Three')],
			'separate',
			async ids => {
				calls.push(ids);
				if (ids[0] === 'wf-2') throw new Error('file already exists');
				return result(ids);
			},
			new AbortController().signal,
		);

		assert.deepStrictEqual(calls, [['wf-1'], ['wf-2'], ['wf-3']]);
		assert.strictEqual(outcome.results.length, 2);
		assert.deepStrictEqual(outcome.failures, [
			{ workflow: workflow('wf-2', 'Two'), message: 'file already exists' },
		]);
		assert.strictEqual(outcome.cancelled, false);
	});

	test('cancellation stops separate exports before starting another workflow', async () => {
		const controller = new AbortController();
		const calls: string[][] = [];
		const outcome = await runWorkflowExports(
			[workflow('wf-1'), workflow('wf-2')],
			'separate',
			async ids => {
				calls.push(ids);
				controller.abort();
				return result(ids);
			},
			controller.signal,
		);

		assert.deepStrictEqual(calls, [['wf-1']]);
		assert.strictEqual(outcome.results.length, 1);
		assert.strictEqual(outcome.cancelled, true);
	});

	test('bundle cancellation before start does not call the backend', async () => {
		const controller = new AbortController();
		controller.abort();
		let called = false;
		const outcome = await runWorkflowExports(
			[workflow('wf-1'), workflow('wf-2')],
			'bundle',
			async ids => {
				called = true;
				return result(ids);
			},
			controller.signal,
		);

		assert.strictEqual(called, false);
		assert.deepStrictEqual(outcome, { results: [], failures: [], cancelled: true });
	});

	test('bundle cancellation during an aborted backend call returns saved results safely', async () => {
		const controller = new AbortController();
		const outcomePromise = runWorkflowExports(
			[workflow('wf-1')],
			'bundle',
			async ids => {
				controller.abort();
				throw new Error('aborted by caller');
			},
			controller.signal,
		);

		await assert.deepStrictEqual(await outcomePromise, { results: [], failures: [], cancelled: true });
	});

	test('bundle mode batches every selected workflow without rejecting large selections', async () => {
		const calls: string[][] = [];
		const workflows = Array.from({ length: MAX_WORKFLOW_EXPORT_BATCH_SIZE + 2 }, (_, index) =>
			workflow(`wf-${index}`),
		);
		const outcome = await runWorkflowExports(
			workflows,
			'bundle',
			async ids => {
				calls.push(ids);
				return result(ids);
			},
			new AbortController().signal,
		);

		assert.strictEqual(calls.length, 2);
		assert.strictEqual(calls[0].length, MAX_WORKFLOW_EXPORT_BATCH_SIZE);
		assert.strictEqual(calls[1].length, 2);
		assert.strictEqual(outcome.results.length, 2);
		assert.deepStrictEqual(
			outcome.results.flatMap(exportResult => exportResult.workflowIds),
			workflows.map(selected => selected.id),
		);
		assert.deepStrictEqual(outcome.failures, []);
		assert.strictEqual(outcome.cancelled, false);
	});

	test('bundle mode continues after a failed batch and identifies the affected workflow ids', async () => {
		const workflows = Array.from({ length: MAX_WORKFLOW_EXPORT_BATCH_SIZE + 1 }, (_, index) =>
			workflow(`wf-${index}`),
		);
		const outcome = await runWorkflowExports(
			workflows,
			'bundle',
			async ids => {
				if (ids.length === MAX_WORKFLOW_EXPORT_BATCH_SIZE) throw new Error('request failed');
				return result(ids);
			},
			new AbortController().signal,
		);

		assert.strictEqual(outcome.results.length, 1);
		assert.deepStrictEqual(outcome.failures, [
			{
				workflowIds: workflows.slice(0, MAX_WORKFLOW_EXPORT_BATCH_SIZE).map(selected => selected.id),
				message: 'request failed',
			},
		]);
	});
});
