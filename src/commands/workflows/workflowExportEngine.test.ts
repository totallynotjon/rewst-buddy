import type { WorkflowExportResult } from '../../../packages/mcp-server/src/capabilities/workflowExportCapability';
import { basename, join } from 'node:path';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import {
	MAX_WORKFLOW_EXPORT_BATCH_SIZE,
	MAX_WORKFLOW_EXPORT_FILENAME_BYTES,
	exportWorkflowBatchToAvailablePath,
	runWorkflowExports,
	resolveWorkflowExportOutputPath,
	sanitizeWorkflowFilenamePart,
	separateWorkflowExportFilename,
	workflowExportOutputPath,
	type ExportWorkflowChoice,
} from './workflowExportEngine';

const { suite, test } = Mocha;

function workflow(id: string, name = id): ExportWorkflowChoice {
	return { id, name, orgId: 'org-1', orgName: 'Org One' };
}

function result(workflowIds: string[], outputPath: string | null = null): WorkflowExportResult {
	return {
		status: 'saved',
		orgId: 'org-1',
		workflowIds,
		recommendedFilename: 'export.json',
		outputPath,
		bytes: 10,
		version: 2,
		exportedAt: '2026-01-01T00:00:00.000Z',
		objectCount: workflowIds.length,
		signingPresent: true,
	};
}

suite('Unit: workflow export engine', () => {
	test('keeps 25 workflows in one bundle and starts a second batch at 26', async () => {
		for (const expected of [
			{ count: MAX_WORKFLOW_EXPORT_BATCH_SIZE, sizes: [25] },
			{ count: MAX_WORKFLOW_EXPORT_BATCH_SIZE + 1, sizes: [25, 1] },
		]) {
			const calls: { ids: string[]; batchIndex: number; batchCount: number }[] = [];
			const selected = Array.from({ length: expected.count }, (_, index) => workflow(`wf-${index + 1}`));

			const outcome = await runWorkflowExports(
				selected,
				'bundle',
				async (ids, batchIndex, batchCount) => {
					calls.push({ ids, batchIndex, batchCount });
					return result(ids);
				},
				new AbortController().signal,
			);

			assert.deepStrictEqual(
				calls.map(call => call.ids.length),
				expected.sizes,
			);
			assert.deepStrictEqual(
				calls.map(call => call.batchIndex),
				expected.sizes.map((_, index) => index),
			);
			assert.deepStrictEqual(
				calls.map(call => call.batchCount),
				expected.sizes.map(() => expected.sizes.length),
			);
			assert.strictEqual(outcome.cancelled, false);
			assert.deepStrictEqual(outcome.failures, []);
		}
	});

	test('reports exact progress increments for a 26-workflow bundle export', async () => {
		const progress: { message: string; increment?: number }[] = [];
		const selected = Array.from({ length: 26 }, (_, index) => workflow(`wf-${index + 1}`));

		await runWorkflowExports(
			selected,
			'bundle',
			async ids => result(ids),
			new AbortController().signal,
			(message, increment) => progress.push({ message, increment }),
		);

		assert.deepStrictEqual(progress, [
			{ message: 'Bundling batch 1/2 25 workflows…', increment: undefined },
			{ message: '25 of 26 complete', increment: 2500 / 26 },
			{ message: 'Bundling batch 2/2 1 workflow…', increment: undefined },
			{ message: '26 of 26 complete', increment: 100 / 26 },
		]);
		assert.strictEqual(
			progress.reduce((total, update) => total + (update.increment ?? 0), 0),
			100,
		);
	});

	test('stops before work when cancelled and preserves completed results when cancelled later', async () => {
		const preCancelled = new AbortController();
		preCancelled.abort();
		let preCancelledCalls = 0;
		assert.deepStrictEqual(
			await runWorkflowExports(
				[workflow('wf-1')],
				'separate',
				async ids => {
					preCancelledCalls++;
					return result(ids);
				},
				preCancelled.signal,
			),
			{ results: [], failures: [], cancelled: true },
		);
		assert.strictEqual(preCancelledCalls, 0);

		const midExport = new AbortController();
		const calls: string[][] = [];
		const outcome = await runWorkflowExports(
			[workflow('wf-1'), workflow('wf-2')],
			'separate',
			async ids => {
				calls.push(ids);
				midExport.abort();
				return result(ids);
			},
			midExport.signal,
		);

		assert.deepStrictEqual(calls, [['wf-1']]);
		assert.deepStrictEqual(
			outcome.results.map(exported => exported.workflowIds),
			[['wf-1']],
		);
		assert.strictEqual(outcome.cancelled, true);
	});

	test('records exporter failures and continues with remaining separate exports', async () => {
		const outcome = await runWorkflowExports(
			[workflow('wf-1', 'One'), workflow('wf-2', 'Two'), workflow('wf-3', 'Three')],
			'separate',
			async ids => {
				if (ids[0] === 'wf-2') throw new Error('backend unavailable');
				return result(ids);
			},
			new AbortController().signal,
		);

		assert.deepStrictEqual(
			outcome.results.map(exported => exported.workflowIds),
			[['wf-1'], ['wf-3']],
		);
		assert.deepStrictEqual(outcome.failures, [
			{ workflow: workflow('wf-2', 'Two'), message: 'backend unavailable' },
		]);
		assert.strictEqual(outcome.cancelled, false);
	});

	test('identifies every workflow in a failed bundle and continues with the next batch', async () => {
		const selected = Array.from({ length: 26 }, (_, index) => workflow(`wf-${index + 1}`));
		const outcome = await runWorkflowExports(
			selected,
			'bundle',
			async (ids, batchIndex) => {
				if (batchIndex === 0) throw 'request rejected';
				return result(ids);
			},
			new AbortController().signal,
		);

		assert.deepStrictEqual(
			outcome.results.map(exported => exported.workflowIds),
			[['wf-26']],
		);
		assert.deepStrictEqual(outcome.failures, [
			{ workflowIds: selected.slice(0, 25).map(item => item.id), message: 'request rejected' },
		]);
	});

	test('makes reserved and control-character filenames portable', () => {
		assert.strictEqual(sanitizeWorkflowFilenamePart('CON'), '_CON');
		assert.strictEqual(sanitizeWorkflowFilenamePart('lpt9.report'), '_lpt9.report');
		assert.strictEqual(sanitizeWorkflowFilenamePart('Daily\u0000\u001f\u007f / Sync'), 'Daily - Sync');
		assert.strictEqual(separateWorkflowExportFilename(workflow('NUL', 'PRN'), true), '_PRN--_NUL.json');
	});

	test('keeps colliding sanitized workflow names unique by workflow id', () => {
		const first = separateWorkflowExportFilename(workflow('wf-1', 'Daily/Sync'), true);
		const second = separateWorkflowExportFilename(workflow('wf-2', 'Daily\\Sync'), true);

		assert.strictEqual(first, 'Daily-Sync--wf-1.json');
		assert.strictEqual(second, 'Daily-Sync--wf-2.json');
		assert.notStrictEqual(first, second);
	});

	test('constrains complete emoji-heavy filenames by UTF-8 bytes at the filesystem boundary', () => {
		const exactBoundary = separateWorkflowExportFilename(workflow('id', `${'😀'.repeat(60)}abcdef`), true);
		assert.strictEqual(Buffer.byteLength(exactBoundary, 'utf8'), MAX_WORKFLOW_EXPORT_FILENAME_BYTES);
		assert.ok(exactBoundary.endsWith('--id.json'));

		const emojiHeavy = separateWorkflowExportFilename(workflow('😀'.repeat(80), '😀'.repeat(150)), true);
		assert.ok(Buffer.byteLength(emojiHeavy, 'utf8') <= MAX_WORKFLOW_EXPORT_FILENAME_BYTES);
		assert.doesNotMatch(emojiHeavy, /�/);

		const fallback = separateWorkflowExportFilename(workflow('😀'.repeat(80), '...'), true);
		assert.ok(fallback.startsWith('workflow--'));
		assert.strictEqual(Buffer.byteLength(fallback, 'utf8'), MAX_WORKFLOW_EXPORT_FILENAME_BYTES);
	});

	test('uses file destinations verbatim and derives directory output paths', () => {
		assert.strictEqual(
			workflowExportOutputPath(
				{ kind: 'file', outputPath: '/chosen/export.json' },
				'/default',
				'bundle',
				[workflow('wf-1')],
				0,
				1,
			),
			'/chosen/export.json',
		);
		assert.strictEqual(
			workflowExportOutputPath(
				{ kind: 'directory', outputPath: '/chosen' },
				'/default',
				'bundle',
				[workflow('wf-1')],
				1,
				3,
			),
			join('/chosen', 'rewst-workflows-batch-002-of-003.json'),
		);
		assert.strictEqual(
			workflowExportOutputPath(
				{ kind: 'directory' },
				'/default',
				'separate',
				[workflow('wf-1', 'Daily Sync')],
				0,
				1,
				true,
			),
			join('/default', 'Daily Sync--wf-1.json'),
		);
	});

	test('preserves free directory filenames and adds deterministic suffixes for existing exports', async () => {
		const existing = new Set<string>();
		const exists = async (path: string): Promise<boolean> => existing.has(path);
		const bundleArgs = [
			{ kind: 'directory' as const, outputPath: '/exports' },
			'/default',
			'bundle' as const,
			[workflow('wf-1')],
			0,
			1,
		] as const;

		assert.strictEqual(
			await resolveWorkflowExportOutputPath(...bundleArgs, false, exists),
			join('/exports', 'rewst-workflows-batch-001-of-001.json'),
		);
		existing.add(join('/exports', 'rewst-workflows-batch-001-of-001.json'));
		assert.strictEqual(
			await resolveWorkflowExportOutputPath(...bundleArgs, false, exists),
			join('/exports', 'rewst-workflows-batch-001-of-001-2.json'),
		);
		existing.add(join('/exports', 'rewst-workflows-batch-001-of-001-2.json'));
		assert.strictEqual(
			await resolveWorkflowExportOutputPath(...bundleArgs, false, exists),
			join('/exports', 'rewst-workflows-batch-001-of-001-3.json'),
		);

		existing.add(join('/exports', 'Daily Sync--wf-1.json'));
		assert.strictEqual(
			await resolveWorkflowExportOutputPath(
				{ kind: 'directory', outputPath: '/exports' },
				'/default',
				'separate',
				[workflow('wf-1', 'Daily Sync')],
				0,
				1,
				true,
				exists,
			),
			join('/exports', 'Daily Sync--wf-1-2.json'),
		);

		const boundaryWorkflow = workflow('id', `${'😀'.repeat(60)}abcdef`);
		const boundaryPath = workflowExportOutputPath(
			{ kind: 'directory', outputPath: '/exports' },
			'/default',
			'separate',
			[boundaryWorkflow],
			0,
			1,
			true,
		)!;
		existing.add(boundaryPath);
		const suffixedBoundaryPath = await resolveWorkflowExportOutputPath(
			{ kind: 'directory', outputPath: '/exports' },
			'/default',
			'separate',
			[boundaryWorkflow],
			0,
			1,
			true,
			exists,
		);
		assert.ok(suffixedBoundaryPath);
		assert.ok(Buffer.byteLength(basename(suffixedBoundaryPath), 'utf8') <= MAX_WORKFLOW_EXPORT_FILENAME_BYTES);
	});

	test('keeps overlapping command and sidebar directory exports distinct', async () => {
		const existing = new Set<string>();
		const paths: string[] = [];
		let releaseFirst!: () => void;
		let markFirstStarted!: () => void;
		const firstStarted = new Promise<void>(resolve => (markFirstStarted = resolve));
		const holdFirst = new Promise<void>(resolve => (releaseFirst = resolve));
		const request = {
			destination: { kind: 'directory' as const, outputPath: '/exports' },
			defaultDirectory: '/default',
			mode: 'bundle' as const,
			workflows: [workflow('wf-1')],
			batchIndex: 0,
			batchCount: 1,
		};
		const exists = async (path: string): Promise<boolean> => existing.has(path);

		const commandExport = exportWorkflowBatchToAvailablePath(
			request,
			async outputPath => {
				assert.ok(outputPath);
				paths.push(outputPath);
				markFirstStarted();
				await holdFirst;
				existing.add(outputPath);
				return outputPath;
			},
			exists,
		);
		await firstStarted;
		const sidebarExport = exportWorkflowBatchToAvailablePath(
			request,
			async outputPath => {
				assert.ok(outputPath);
				paths.push(outputPath);
				existing.add(outputPath);
				return outputPath;
			},
			exists,
		);
		releaseFirst();

		assert.deepStrictEqual(await Promise.all([commandExport, sidebarExport]), [
			join('/exports', 'rewst-workflows-batch-001-of-001.json'),
			join('/exports', 'rewst-workflows-batch-001-of-001-2.json'),
		]);
		assert.deepStrictEqual(paths, [
			join('/exports', 'rewst-workflows-batch-001-of-001.json'),
			join('/exports', 'rewst-workflows-batch-001-of-001-2.json'),
		]);
	});

	test('does not rewrite an explicitly chosen file destination', async () => {
		assert.strictEqual(
			await resolveWorkflowExportOutputPath(
				{ kind: 'file', outputPath: '/chosen/export.json' },
				'/default',
				'bundle',
				[workflow('wf-1')],
				0,
				1,
				false,
				async () => true,
			),
			'/chosen/export.json',
		);
	});
});
