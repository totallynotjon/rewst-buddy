import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { ExportWorkflowChoice } from '../../commands/workflows/workflowExportEngine';
import {
	filterWorkflowCatalog,
	filterWorkflowOrganizations,
	normalizeWorkflowCatalog,
	parseWorkflowCatalogFilters,
	workflowTagOptions,
} from './workflowExportModel';

const { suite, test } = Mocha;

function workflow(overrides: Partial<ExportWorkflowChoice> = {}): ExportWorkflowChoice {
	return {
		id: 'wf-1',
		name: 'Morning Sync',
		orgId: 'org-1',
		orgName: 'Org One',
		createdAt: '2026-01-10T12:00:00.000Z',
		updatedAt: '2026-03-15T12:00:00.000Z',
		tags: [{ id: 'ops', name: 'Operations' }],
		...overrides,
	};
}

suite('Unit: workflow export catalog model', () => {
	test('normalizes metadata, removes duplicate ids, and collects sorted tags', () => {
		const workflows = normalizeWorkflowCatalog(
			[
				{
					id: ' wf-1 ',
					name: ' Morning Sync ',
					createdAt: '2026-01-10',
					updatedAt: '2026-03-15',
					tags: [
						{ id: 'ops', name: 'Operations' },
						{ id: 'alpha', name: 'Alpha' },
					],
				},
				{ id: 'wf-1', name: 'duplicate' },
				{ id: null, name: 'missing' },
			],
			{ id: 'org-1', name: 'Org One' },
		);

		assert.strictEqual(workflows.length, 1);
		assert.strictEqual(workflows[0].name, 'Morning Sync');
		assert.deepStrictEqual(workflowTagOptions(workflows), [
			{ id: 'alpha', name: 'Alpha' },
			{ id: 'ops', name: 'Operations' },
		]);
	});

	test('filters organizations for the single searchable picker', () => {
		assert.deepStrictEqual(
			filterWorkflowOrganizations(
				[
					{ id: 'org-main', name: 'Main Organization' },
					{ id: 'org-ops', name: 'Operations' },
				],
				'ops',
			).map(org => org.id),
			['org-ops'],
		);
	});

	test('filters search, any/all tags, and inclusive created/updated dates', () => {
		const workflows = [
			workflow(),
			workflow({
				id: 'wf-2',
				name: 'Evening Audit',
				createdAt: '2026-02-05T00:00:00.000Z',
				updatedAt: '2026-04-20T23:59:59.000Z',
				tags: [
					{ id: 'ops', name: 'Operations' },
					{ id: 'audit', name: 'Audit' },
				],
			}),
		];

		assert.deepStrictEqual(
			filterWorkflowCatalog(workflows, {
				search: 'audit',
				tagIds: ['ops', 'audit'],
				tagMatch: 'all',
				createdFrom: '2026-02-05',
				createdTo: '2026-02-05',
				updatedFrom: '2026-04-20',
				updatedTo: '2026-04-20',
			}).map(item => item.id),
			['wf-2'],
		);
		assert.strictEqual(
			filterWorkflowCatalog(workflows, {
				search: '',
				tagIds: ['missing', 'ops'],
				tagMatch: 'any',
			}).length,
			2,
		);
	});

	test('interprets epoch seconds and milliseconds without expanding valid 12-digit milliseconds', () => {
		const workflows = [
			workflow({ id: 'seconds', createdAt: '946684800' }),
			workflow({ id: 'twelve-digit-milliseconds', createdAt: '946684800000' }),
			workflow({ id: 'thirteen-digit-milliseconds', createdAt: '1767225600000' }),
			workflow({ id: 'invalid', createdAt: 'not-a-timestamp' }),
		];

		assert.deepStrictEqual(
			filterWorkflowCatalog(workflows, {
				search: '',
				tagIds: [],
				tagMatch: 'any',
				createdFrom: '2000-01-01',
				createdTo: '2000-01-01',
			}).map(item => item.id),
			['seconds', 'twelve-digit-milliseconds'],
		);
		assert.deepStrictEqual(
			filterWorkflowCatalog(workflows, {
				search: '',
				tagIds: [],
				tagMatch: 'any',
				createdFrom: '2026-01-01',
				createdTo: '2026-01-01',
			}).map(item => item.id),
			['thirteen-digit-milliseconds'],
		);
	});

	test('excludes missing timestamps when a date range is active and safely parses webview input', () => {
		assert.deepStrictEqual(
			filterWorkflowCatalog([workflow({ createdAt: null })], {
				search: '',
				tagIds: [],
				tagMatch: 'any',
				createdFrom: '2026-01-01',
			}),
			[],
		);
		assert.deepStrictEqual(parseWorkflowCatalogFilters({ tagIds: ['ops', 'ops', null], tagMatch: 'all' }), {
			search: '',
			tagIds: ['ops'],
			tagMatch: 'all',
			createdFrom: undefined,
			createdTo: undefined,
			updatedFrom: undefined,
			updatedTo: undefined,
		});
	});

	test('treats invalid non-empty date bounds as unbounded', () => {
		assert.deepStrictEqual(
			filterWorkflowCatalog([workflow()], {
				search: '',
				tagIds: [],
				tagMatch: 'any',
				createdFrom: 'not-a-date',
				updatedTo: 'also-not-a-date',
			}),
			[workflow()],
		);
	});
});
