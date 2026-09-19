import type { ExportWorkflowRow } from '../../backend/editorDataClient';
import type { ExportWorkflowChoice } from '../../commands/workflows/workflowExportEngine';

export type WorkflowTagMatch = 'any' | 'all';

export interface WorkflowCatalogFilters {
	search: string;
	tagIds: string[];
	tagMatch: WorkflowTagMatch;
	createdFrom?: string;
	createdTo?: string;
	updatedFrom?: string;
	updatedTo?: string;
}

export interface WorkflowTagOption {
	id: string;
	name: string;
}

export interface WorkflowExportOrganizationOption {
	id: string;
	name: string;
}

function clean(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function filterWorkflowOrganizations(
	organizations: readonly WorkflowExportOrganizationOption[],
	query: string,
): WorkflowExportOrganizationOption[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return organizations.filter(organization =>
		`${organization.name} ${organization.id}`.toLocaleLowerCase().includes(normalizedQuery),
	);
}

export function normalizeWorkflowCatalog(
	rows: readonly ExportWorkflowRow[],
	org: { id: string; name: string },
): ExportWorkflowChoice[] {
	const seen = new Set<string>();
	return rows.flatMap(row => {
		const id = clean(row.id);
		if (!id || seen.has(id)) return [];
		seen.add(id);
		const tags = (row.tags ?? []).flatMap(tag => {
			const tagId = clean(tag.id);
			if (!tagId) return [];
			return [{ id: tagId, name: clean(tag.name) ?? tagId }];
		});
		return [
			{
				id,
				name: clean(row.name) ?? id,
				orgId: clean(row.orgId) ?? org.id,
				orgName: org.name,
				createdAt: row.createdAt ?? null,
				updatedAt: row.updatedAt ?? null,
				tags,
			},
		];
	});
}

export function workflowTagOptions(workflows: readonly ExportWorkflowChoice[]): WorkflowTagOption[] {
	const tags = new Map<string, string>();
	for (const workflow of workflows) {
		for (const tag of workflow.tags ?? []) {
			const id = clean(tag.id);
			if (id && !tags.has(id)) tags.set(id, clean(tag.name) ?? id);
		}
	}
	return [...tags].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function timestamp(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	if (/^\d+$/.test(value)) {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return undefined;
		const epochMilliseconds = value.length <= 10 ? numeric * 1000 : numeric;
		return Number.isFinite(new Date(epochMilliseconds).getTime()) ? epochMilliseconds : undefined;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function dateFloor(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Date.parse(`${value}T00:00:00.000Z`);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function dateCeiling(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Date.parse(`${value}T23:59:59.999Z`);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function withinDateRange(value: string | null | undefined, from?: string, to?: string): boolean {
	if (!from && !to) return true;
	const actual = timestamp(value);
	if (actual === undefined) return false;
	const minimum = dateFloor(from);
	const maximum = dateCeiling(to);
	return (minimum === undefined || actual >= minimum) && (maximum === undefined || actual <= maximum);
}

export function filterWorkflowCatalog(
	workflows: readonly ExportWorkflowChoice[],
	filters: WorkflowCatalogFilters,
): ExportWorkflowChoice[] {
	const query = filters.search.trim().toLocaleLowerCase();
	const selectedTags = new Set(filters.tagIds.filter(Boolean));
	return workflows.filter(workflow => {
		const searchable = `${workflow.name}\n${workflow.id}\n${workflow.orgName}`.toLocaleLowerCase();
		if (query && !searchable.includes(query)) return false;
		const workflowTags = new Set((workflow.tags ?? []).flatMap(tag => (clean(tag.id) ? [clean(tag.id)!] : [])));
		if (
			selectedTags.size > 0 &&
			(filters.tagMatch === 'all'
				? ![...selectedTags].every(tag => workflowTags.has(tag))
				: ![...selectedTags].some(tag => workflowTags.has(tag)))
		)
			return false;
		return (
			withinDateRange(workflow.createdAt, filters.createdFrom, filters.createdTo) &&
			withinDateRange(workflow.updatedAt, filters.updatedFrom, filters.updatedTo)
		);
	});
}

export function parseWorkflowCatalogFilters(value: unknown): WorkflowCatalogFilters {
	const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const tagIds = Array.isArray(input.tagIds) ? input.tagIds.flatMap(id => (clean(id) ? [clean(id)!] : [])) : [];
	return {
		search: clean(input.search) ?? '',
		tagIds: [...new Set(tagIds)],
		tagMatch: input.tagMatch === 'all' ? 'all' : 'any',
		createdFrom: clean(input.createdFrom),
		createdTo: clean(input.createdTo),
		updatedFrom: clean(input.updatedFrom),
		updatedTo: clean(input.updatedTo),
	};
}
