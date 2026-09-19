import { beforeEach, expect, vi } from 'vitest';
import { suite, test } from '../test/tdd';

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
}));

vi.mock('./operations', () => ({ invoke: mocks.invoke }));

import { editorDataClient } from './editorDataClient';

suite('Unit: editorDataClient workflow export contract', () => {
	beforeEach(() => {
		mocks.invoke.mockReset();
	});

	test('forwards catalog, default-directory, and export requests to their editor operations', async () => {
		const signal = new AbortController().signal;
		const options = { signal };
		const catalog = [{ id: 'workflow-1', name: 'Daily Sync', orgId: 'org-1' }];
		const exportResult = {
			status: 'saved',
			orgId: 'org-1',
			workflowIds: ['workflow-1'],
			recommendedFilename: 'workflow-export.json',
			outputPath: '/exports/workflow-export.json',
			bytes: 128,
			version: 2,
			exportedAt: '2026-09-18T12:00:00.000Z',
			objectCount: 1,
			signingPresent: true,
		};
		mocks.invoke
			.mockResolvedValueOnce(catalog)
			.mockResolvedValueOnce('/exports')
			.mockResolvedValueOnce(exportResult);

		await expect(
			editorDataClient.listExportWorkflows({ sessionId: 'session-1', orgId: 'org-1' }, options),
		).resolves.toBe(catalog);
		await expect(editorDataClient.getWorkflowExportDefaultDirectory(options)).resolves.toBe('/exports');
		await expect(
			editorDataClient.exportWorkflows(
				{
					sessionId: 'session-1',
					orgId: 'org-1',
					workflowIds: ['workflow-1'],
					outputPath: '/exports/workflow-export.json',
				},
				options,
			),
		).resolves.toBe(exportResult);

		expect(mocks.invoke.mock.calls).toEqual([
			['workflows.export.catalog', { sessionId: 'session-1', orgId: 'org-1' }, { signal }],
			['workflows.export.defaultDirectory', {}, { signal }],
			[
				'workflows.export.run',
				{
					sessionId: 'session-1',
					orgId: 'org-1',
					workflowIds: ['workflow-1'],
					outputPath: '/exports/workflow-export.json',
				},
				{ signal },
			],
		]);
	});

	test('preserves backend rejections', async () => {
		const expected = new Error('workflow export unavailable');
		mocks.invoke.mockRejectedValueOnce(expected);

		await expect(
			editorDataClient.exportWorkflows({
				sessionId: 'session-1',
				orgId: 'org-1',
				workflowIds: ['workflow-1'],
			}),
		).rejects.toBe(expected);
	});
});
