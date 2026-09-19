import { context } from '@global';
import type { Org } from '@models';
import type { Session } from '@sessions';
import { pickOrganization } from '@ui';
import { log } from '@utils';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import vscode from 'vscode';
import { editorDataClient, type ExportWorkflowRow } from '../../backend/editorDataClient';
import type { WorkflowExportResult } from '../../../packages/mcp-server/src/capabilities/workflowExportCapability';
import GenericCommand from '../GenericCommand';
import {
	MAX_WORKFLOW_EXPORT_BATCH_SIZE,
	exportWorkflowBatchToAvailablePath,
	runWorkflowExports,
	type ExportWorkflowChoice,
	type WorkflowExportDestination,
	type WorkflowExportFlowResult,
	type WorkflowExportMode,
} from './workflowExportEngine';

export {
	MAX_WORKFLOW_EXPORT_BATCH_SIZE,
	MAX_WORKFLOW_EXPORT_FILENAME_BYTES,
	exportWorkflowBatchToAvailablePath,
	runWorkflowExports,
	resolveWorkflowExportOutputPath,
	sanitizeWorkflowFilenamePart,
	separateWorkflowExportFilename,
	workflowExportOutputPath,
} from './workflowExportEngine';
export type {
	ExportWorkflowChoice,
	WorkflowExportDestination,
	WorkflowExportFailure,
	WorkflowExportFlowResult,
	WorkflowExportMode,
} from './workflowExportEngine';
export const WORKFLOW_CATALOG_CACHE_KEY = 'WorkflowExportCatalog.v1';
export const MAX_WORKFLOW_CATALOG_CACHE_ENTRIES = 20;

export interface WorkflowQuickPickItem extends vscode.QuickPickItem {
	workflow: ExportWorkflowChoice;
}

interface WorkflowCatalogCacheEntry {
	sessionId: string;
	orgId: string;
	fetchedAt: string;
	workflows: ExportWorkflowRow[];
}

interface WorkflowCatalogCache {
	entries: Record<string, WorkflowCatalogCacheEntry>;
}

function cacheEntryId(sessionId: string, orgId: string): string {
	return `${sessionId}\u0000${orgId}`;
}

function isWorkflowCatalogCacheEntry(value: unknown): value is WorkflowCatalogCacheEntry {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Partial<WorkflowCatalogCacheEntry>;
	return (
		typeof entry.sessionId === 'string' &&
		entry.sessionId.length > 0 &&
		typeof entry.orgId === 'string' &&
		entry.orgId.length > 0 &&
		typeof entry.fetchedAt === 'string' &&
		Number.isFinite(Date.parse(entry.fetchedAt)) &&
		Array.isArray(entry.workflows)
	);
}

export function readCachedWorkflowCatalog(sessionId: string, orgId: string): WorkflowCatalogCacheEntry | undefined {
	const cache = context.globalState.get<unknown>(WORKFLOW_CATALOG_CACHE_KEY, { entries: {} });
	if (!cache || typeof cache !== 'object') return undefined;
	const entries = (cache as Partial<WorkflowCatalogCache>).entries;
	if (!entries || typeof entries !== 'object') return undefined;
	const entry = entries[cacheEntryId(sessionId, orgId)];
	if (!isWorkflowCatalogCacheEntry(entry) || entry.sessionId !== sessionId || entry.orgId !== orgId) return undefined;
	return entry;
}

export async function writeCachedWorkflowCatalog(entry: WorkflowCatalogCacheEntry): Promise<void> {
	const cache = context.globalState.get<unknown>(WORKFLOW_CATALOG_CACHE_KEY, { entries: {} });
	const storedEntries =
		cache && typeof cache === 'object' ? (cache as Partial<WorkflowCatalogCache>).entries : undefined;
	const entries = Object.fromEntries(
		Object.entries(storedEntries && typeof storedEntries === 'object' ? storedEntries : {}).filter(([, value]) =>
			isWorkflowCatalogCacheEntry(value),
		),
	);
	entries[cacheEntryId(entry.sessionId, entry.orgId)] = entry;
	const retainedEntries = Object.fromEntries(
		Object.entries(entries)
			.sort(([, left], [, right]) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt))
			.slice(0, MAX_WORKFLOW_CATALOG_CACHE_ENTRIES),
	);
	await context.globalState.update(WORKFLOW_CATALOG_CACHE_KEY, {
		entries: retainedEntries,
	} satisfies WorkflowCatalogCache);
}

export function persistWorkflowCatalog(entry: WorkflowCatalogCacheEntry): void {
	void writeCachedWorkflowCatalog(entry).catch(error =>
		log.warn('Failed to persist workflow export catalog cache.', error),
	);
}

/** Builds searchable picker rows and always exposes ids so duplicate names remain distinguishable. */
export function workflowQuickPickItems(
	rows: readonly ExportWorkflowRow[],
	org: Pick<Org, 'id' | 'name'>,
): WorkflowQuickPickItem[] {
	const seen = new Set<string>();
	return rows.flatMap(row => {
		const id = typeof row.id === 'string' ? row.id.trim() : '';
		if (!id || seen.has(id)) return [];
		seen.add(id);
		const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id;
		const orgId = typeof row.orgId === 'string' && row.orgId.trim() ? row.orgId.trim() : org.id;
		return [
			{
				label: name,
				description: `${org.name} • ${orgId}`,
				detail: `Workflow ID: ${id}`,
				workflow: {
					id,
					name,
					orgId,
					orgName: org.name,
					...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
					...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
					...(row.tags === undefined ? {} : { tags: row.tags }),
				},
			},
		];
	});
}

async function fetchCatalog(sessionId: string, org: Org): Promise<WorkflowCatalogCacheEntry | undefined> {
	let cancelled = false;
	let workflows: ExportWorkflowRow[];
	try {
		workflows = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Loading workflows for ${org.name}…`,
				cancellable: true,
			},
			async (_progress, token) => {
				const controller = new AbortController();
				const listener = token.onCancellationRequested(() => {
					cancelled = true;
					controller.abort();
				});
				try {
					return await editorDataClient.listExportWorkflows(
						{ sessionId, orgId: org.id },
						{ signal: controller.signal },
					);
				} finally {
					listener.dispose();
				}
			},
		);
	} catch (error) {
		if (cancelled) return undefined;
		throw error;
	}
	if (cancelled) return undefined;
	const entry = { sessionId, orgId: org.id, fetchedAt: new Date().toISOString(), workflows };
	persistWorkflowCatalog(entry);
	return entry;
}

export async function chooseWorkflowCatalog(
	sessionId: string,
	org: Org,
): Promise<WorkflowCatalogCacheEntry | undefined> {
	const cached = readCachedWorkflowCatalog(sessionId, org.id);
	if (!cached) return fetchCatalog(sessionId, org);

	const source = await vscode.window.showQuickPick(
		[
			{
				label: '$(history) Use cached workflow catalog',
				description: `${cached.workflows.length} workflows`,
				detail: `Updated ${new Date(cached.fetchedAt).toLocaleString()}`,
				value: 'cached' as const,
			},
			{
				label: '$(refresh) Refresh from Rewst',
				description: 'Fetch the latest workflow list',
				value: 'refresh' as const,
			},
		],
		{ placeHolder: 'Choose the workflow catalog source' },
	);
	if (!source) return undefined;
	return source.value === 'cached' ? cached : fetchCatalog(sessionId, org);
}

async function pickWorkflows(
	rows: readonly ExportWorkflowRow[],
	org: Org,
): Promise<ExportWorkflowChoice[] | undefined> {
	const items = workflowQuickPickItems(rows, org);
	if (items.length === 0) {
		log.notifyInfo(`No workflows are visible in ${org.name}.`);
		return undefined;
	}

	for (;;) {
		const picked = await vscode.window.showQuickPick(items, {
			title: 'Export Workflows',
			placeHolder: 'Search by workflow name, id, or organization',
			canPickMany: true,
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!picked) return undefined;
		if (picked.length === 0) {
			await vscode.window.showWarningMessage('Select at least one workflow to export.');
			continue;
		}
		return picked.map(item => item.workflow);
	}
}

async function pickMode(workflowCount: number): Promise<WorkflowExportMode | undefined> {
	if (workflowCount === 1) return 'bundle';
	const picked = await vscode.window.showQuickPick(
		[
			{
				label:
					workflowCount > MAX_WORKFLOW_EXPORT_BATCH_SIZE
						? '$(package) Bundled batch files'
						: '$(package) One bundled file',
				detail:
					workflowCount > MAX_WORKFLOW_EXPORT_BATCH_SIZE
						? `Export all ${workflowCount} selected workflows as signed bundles of up to ${MAX_WORKFLOW_EXPORT_BATCH_SIZE} workflows each.`
						: `Export all ${workflowCount} selected workflows and their templates into one signed JSON bundle.`,
				mode: 'bundle' as const,
			},
			{
				label: '$(files) Separate files',
				detail: 'Export each selected workflow and its templates independently; failures do not stop the rest.',
				mode: 'separate' as const,
			},
		],
		{ placeHolder: 'Choose how to export the selected workflows' },
	);
	return picked?.mode;
}

/** Validates the path form before any authenticated export work starts. */
export async function validateWorkflowExportPath(
	value: string,
	mode: WorkflowExportMode,
	workflowCount = 1,
): Promise<string | undefined> {
	const path = value.trim();
	if (!path) return 'Enter an export path.';
	if (!isAbsolute(path)) return 'Enter an absolute export path.';
	if (mode === 'bundle' && workflowCount <= MAX_WORKFLOW_EXPORT_BATCH_SIZE) return undefined;
	try {
		if ((await stat(path)).isDirectory()) return undefined;
	} catch {
		// Keep filesystem details out of the input validation message.
	}
	return mode === 'bundle'
		? 'Choose an existing export folder for bundled batch files.'
		: 'Choose an existing export folder for separate files.';
}

export type WorkflowExportDestinationChoice = vscode.QuickPickItem & {
	value: 'default' | 'folder' | 'file' | 'input';
};

export function workflowExportDestinationChoices(
	mode: WorkflowExportMode,
	defaultDirectory: string,
	workflowCount = 1,
): WorkflowExportDestinationChoice[] {
	return [
		{
			label: '$(home) Use default export folder',
			detail: defaultDirectory,
			value: 'default',
		},
		{
			label: '$(folder-opened) Choose destination folder…',
			value: 'folder',
		},
		...(mode === 'bundle' && workflowCount <= MAX_WORKFLOW_EXPORT_BATCH_SIZE
			? [
					{
						label: '$(file) Choose destination file…',
						value: 'file' as const,
					},
				]
			: []),
		{
			label: '$(edit) Enter an absolute path…',
			detail:
				mode === 'bundle' && workflowCount <= MAX_WORKFLOW_EXPORT_BATCH_SIZE
					? 'Enter a folder or JSON file path'
					: 'Enter an existing folder path',
			value: 'input',
		},
	];
}

export async function workflowExportTargetExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
		throw error;
	}
}

export async function pickDestination(
	mode: WorkflowExportMode,
	defaultDirectory: string,
	workflowCount: number,
): Promise<WorkflowExportDestination | undefined> {
	const choices = workflowExportDestinationChoices(mode, defaultDirectory, workflowCount);
	const picked = await vscode.window.showQuickPick(choices, { placeHolder: 'Choose an export location' });
	if (!picked) return undefined;
	if (picked.value === 'default') return { kind: 'directory' };
	if (picked.value === 'folder') {
		const selected = await vscode.window.showOpenDialog({
			defaultUri: vscode.Uri.file(defaultDirectory),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Export Here',
			title: 'Choose Workflow Export Folder',
		});
		return selected?.[0] ? { outputPath: selected[0].fsPath, kind: 'directory' } : undefined;
	}
	if (picked.value === 'file') {
		for (;;) {
			const selected = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.joinPath(vscode.Uri.file(defaultDirectory), 'rewst-workflows-export.json'),
				filters: { JSON: ['json'] },
				saveLabel: 'Export',
				title: 'Choose Workflow Export File',
			});
			if (!selected) return undefined;
			if (await workflowExportTargetExists(selected.fsPath)) {
				await vscode.window.showWarningMessage(
					'Choose a new file name; workflow exports never overwrite files.',
				);
				continue;
			}
			return { outputPath: selected.fsPath, kind: 'file' };
		}
	}

	const entered = await vscode.window.showInputBox({
		title: 'Workflow Export Location',
		prompt:
			mode === 'bundle' && workflowCount <= MAX_WORKFLOW_EXPORT_BATCH_SIZE
				? 'Absolute folder or JSON file path'
				: 'Absolute existing folder path',
		value: defaultDirectory,
		ignoreFocusOut: true,
		validateInput: value => validateWorkflowExportPath(value, mode, workflowCount),
	});
	if (entered === undefined) return undefined;
	const outputPath = entered.trim();
	let kind: WorkflowExportDestination['kind'] = 'file';
	try {
		kind = (await stat(outputPath)).isDirectory() ? 'directory' : 'file';
	} catch {
		// A new input path is treated as a file, matching LocalExportStorage.
	}
	return { outputPath, kind };
}

async function revealFirstResult(results: readonly WorkflowExportResult[]): Promise<void> {
	const outputPath = results.find(result => typeof result.outputPath === 'string')?.outputPath;
	if (outputPath) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
}

async function presentOutcome(
	outcome: WorkflowExportFlowResult,
	workflowCount: number,
	mode: WorkflowExportMode,
): Promise<void> {
	const reveal = outcome.results.some(result => result.outputPath) ? 'Reveal in File Manager' : undefined;
	let choice: string | undefined;
	if (outcome.cancelled) {
		choice = await vscode.window.showInformationMessage(
			`Workflow export cancelled. ${outcome.results.length} file${outcome.results.length === 1 ? '' : 's'} saved.`,
			...(reveal ? [reveal] : []),
		);
	} else if (outcome.failures.length > 0) {
		const detail = outcome.failures
			.map(failure =>
				failure.workflow
					? `${failure.workflow.name} (${failure.workflow.id}): ${failure.message}`
					: `Batch (${failure.workflowIds?.join(', ') ?? 'unknown workflows'}): ${failure.message}`,
			)
			.join('\n');
		const exportedWorkflowCount = outcome.results.reduce((count, result) => count + result.workflowIds.length, 0);
		choice = await vscode.window.showWarningMessage(
			`Exported ${exportedWorkflowCount} of ${workflowCount} workflows. ${outcome.failures.length} export${outcome.failures.length === 1 ? '' : 's'} failed.`,
			{ modal: true, detail },
			...(reveal ? [reveal] : []),
		);
	} else {
		const fileCount = outcome.results.length;
		choice = await vscode.window.showInformationMessage(
			mode === 'bundle'
				? fileCount === 1
					? `Exported ${workflowCount} workflow${workflowCount === 1 ? '' : 's'} to ${outcome.results[0]?.outputPath ?? 'the default export folder'}.`
					: `Exported ${workflowCount} workflows across ${fileCount} signed bundle files.`
				: `Exported ${workflowCount} workflows to ${fileCount} separate files.`,
			...(reveal ? [reveal] : []),
		);
	}
	if (reveal && choice === reveal) await revealFirstResult(outcome.results);
}

export class ExportWorkflows extends GenericCommand {
	commandName = 'ExportWorkflows';

	async execute(): Promise<void> {
		try {
			await this.executeFlow();
		} catch (error) {
			log.notifyError('Workflow export failed:', error);
		}
	}

	private async executeFlow(): Promise<void> {
		const pickedOrg = await pickOrganization();
		if (!pickedOrg) return;
		const sessionId = sessionIdFor(pickedOrg.session);
		const catalog = await chooseWorkflowCatalog(sessionId, pickedOrg.org);
		if (!catalog) return;
		const workflows = await pickWorkflows(catalog.workflows, pickedOrg.org);
		if (!workflows) return;
		const mode = await pickMode(workflows.length);
		if (!mode) return;
		const defaultDirectory = await editorDataClient.getWorkflowExportDefaultDirectory();
		const destination = await pickDestination(mode, defaultDirectory, workflows.length);
		if (!destination) return;

		const outcome = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Exporting Rewst workflows…',
				cancellable: true,
			},
			async (progress, token) => {
				const controller = new AbortController();
				const listener = token.onCancellationRequested(() => controller.abort());
				try {
					return await runWorkflowExports(
						workflows,
						mode,
						(workflowIds, batchIndex, batchCount) => {
							const batchIds = new Set(workflowIds);
							return exportWorkflowBatchToAvailablePath(
								{
									destination,
									defaultDirectory,
									mode,
									workflows: workflows.filter(workflow => batchIds.has(workflow.id)),
									batchIndex,
									batchCount,
								},
								outputPath =>
									editorDataClient.exportWorkflows(
										{
											sessionId,
											orgId: pickedOrg.org.id,
											workflowIds,
											outputPath,
										},
										{ signal: controller.signal },
									),
							);
						},
						controller.signal,
						(message, increment) => progress.report({ message, increment }),
					);
				} finally {
					listener.dispose();
				}
			},
		);
		await presentOutcome(outcome, workflows.length, mode);
	}
}

function sessionIdFor(session: Session): string {
	const sessionId = session.sessionId ?? session.profile.user.id;
	if (!sessionId) throw new Error('Session has no user id.');
	return sessionId;
}
