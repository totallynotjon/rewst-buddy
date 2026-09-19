import { stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { SessionManager, type Session } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { editorDataClient } from '../../backend/editorDataClient';
import {
	MAX_WORKFLOW_EXPORT_BATCH_SIZE,
	exportWorkflowBatchToAvailablePath,
	runWorkflowExports,
	type ExportWorkflowChoice,
	type WorkflowExportDestination,
	type WorkflowExportMode,
} from '../../commands/workflows/workflowExportEngine';
import { WORKFLOW_EXPORT_BOOTSTRAP_PAYLOAD } from '../../../packages/mcp-server/src/capabilities/workflowExportCapability';
import {
	filterWorkflowCatalog,
	normalizeWorkflowCatalog,
	parseWorkflowCatalogFilters,
	workflowTagOptions,
} from './workflowExportModel';

export interface WorkflowExportOrganization {
	id: string;
	name: string;
}

function sessionIdFor(session: Session): string | undefined {
	return session.sessionId ?? session.profile.user.id ?? undefined;
}

export function workflowExportOrganizations(sessions: readonly Session[]): WorkflowExportOrganization[] {
	const result = new Map<string, WorkflowExportOrganization>();
	for (const session of sessions) {
		if (!sessionIdFor(session)) continue;
		for (const org of [session.profile.org, ...(session.profile.allManagedOrgs ?? [])]) {
			if (!org?.id || result.has(org.id)) continue;
			result.set(org.id, { id: org.id, name: org.name || org.id });
		}
	}
	return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveWorkflowExportSessionId(orgId: string): Promise<string> {
	const session = await SessionManager.getSessionForOrg(orgId);
	const sessionId = sessionIdFor(session);
	if (!sessionId) throw new Error(`No usable session is available for organization "${orgId}".`);
	return sessionId;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function messageRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

type WorkflowExportStat = (path: string) => Promise<unknown>;

export async function workflowExportTargetExists(path: string, statPath: WorkflowExportStat = stat): Promise<boolean> {
	try {
		await statPath(path);
		return true;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
		throw error;
	}
}

export class WorkflowExportViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	static readonly viewType = 'rewst-buddy.workflowExporter';

	private view?: vscode.WebviewView;
	private catalog: ExportWorkflowChoice[] = [];
	private catalogOrgId?: string;
	private defaultDirectory?: string;
	private destination: WorkflowExportDestination = { kind: 'directory' };
	private catalogController?: AbortController;
	private exportController?: AbortController;
	private readonly knownOutputPaths = new Set<string>();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly extensionUri: vscode.Uri) {
		this.disposables.push(SessionManager.onSessionChange(() => void this.postOrganizations()));
	}

	dispose(): void {
		this.catalogController?.abort();
		this.exportController?.abort();
		for (const disposable of this.disposables.splice(0)) disposable.dispose();
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media', 'workflow-exporter')],
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		this.disposables.push(webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message)));
	}

	private async post(message: Record<string, unknown>): Promise<void> {
		await this.view?.webview.postMessage(message);
	}

	private organizations(): WorkflowExportOrganization[] {
		return workflowExportOrganizations(SessionManager.getActiveSessions());
	}

	private organization(orgId: unknown): WorkflowExportOrganization | undefined {
		return typeof orgId === 'string' ? this.organizations().find(org => org.id === orgId) : undefined;
	}

	private async postOrganizations(): Promise<void> {
		await this.post({ type: 'organizations', organizations: this.organizations() });
	}

	private async bootstrap(): Promise<void> {
		try {
			this.defaultDirectory ??= await editorDataClient.getWorkflowExportDefaultDirectory();
			await this.post({
				type: 'bootstrap',
				...WORKFLOW_EXPORT_BOOTSTRAP_PAYLOAD,
				organizations: this.organizations(),
				defaultDirectory: this.defaultDirectory,
				catalogOrgId: this.catalogOrgId ?? null,
			});
		} catch (error) {
			await this.post({
				type: 'error',
				message: `Unable to initialize workflow exports: ${errorMessage(error)}`,
			});
		}
	}

	private async loadCatalog(orgId: unknown): Promise<void> {
		const org = this.organization(orgId);
		if (!org) {
			await this.post({ type: 'error', message: 'Choose an active Rewst organization.' });
			return;
		}
		this.catalogController?.abort();
		const controller = new AbortController();
		this.catalogController = controller;
		this.catalog = [];
		this.catalogOrgId = undefined;
		await this.post({ type: 'catalogLoading', orgId: org.id });
		try {
			const sessionId = await resolveWorkflowExportSessionId(org.id);
			const rows = await editorDataClient.listExportWorkflows(
				{ sessionId, orgId: org.id },
				{ signal: controller.signal },
			);
			if (controller.signal.aborted || this.catalogController !== controller) return;
			this.catalog = normalizeWorkflowCatalog(rows, org);
			this.catalogOrgId = org.id;
			await this.post({
				type: 'catalogLoaded',
				orgId: org.id,
				workflows: this.catalog,
				tags: workflowTagOptions(this.catalog),
			});
		} catch (error) {
			if (!controller.signal.aborted)
				await this.post({ type: 'error', message: `Unable to load workflows: ${errorMessage(error)}` });
		} finally {
			if (this.catalogController === controller) this.catalogController = undefined;
		}
	}

	private async applyFilters(value: unknown): Promise<void> {
		const filters = parseWorkflowCatalogFilters(value);
		await this.post({
			type: 'filterResult',
			workflowIds: filterWorkflowCatalog(this.catalog, filters).map(workflow => workflow.id),
		});
	}

	private async chooseFolder(): Promise<void> {
		this.defaultDirectory ??= await editorDataClient.getWorkflowExportDefaultDirectory();
		const selected = await vscode.window.showOpenDialog({
			defaultUri: vscode.Uri.file(this.destination.outputPath ?? this.defaultDirectory),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Export Here',
			title: 'Choose Workflow Export Folder',
		});
		if (!selected?.[0]) return;
		this.destination = { kind: 'directory', outputPath: selected[0].fsPath };
		await this.post({ type: 'destination', kind: 'directory', path: selected[0].fsPath, isDefault: false });
	}

	private async chooseFile(workflowCount: unknown): Promise<void> {
		if (typeof workflowCount !== 'number' || workflowCount < 1 || workflowCount > MAX_WORKFLOW_EXPORT_BATCH_SIZE) {
			await this.post({
				type: 'error',
				message: `A single bundle file supports 1-${MAX_WORKFLOW_EXPORT_BATCH_SIZE} selected workflows.`,
			});
			return;
		}
		this.defaultDirectory ??= await editorDataClient.getWorkflowExportDefaultDirectory();
		const selected = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.joinPath(vscode.Uri.file(this.defaultDirectory), 'rewst-workflows-export.json'),
			filters: { JSON: ['json'] },
			saveLabel: 'Export',
			title: 'Choose Workflow Export File',
		});
		if (!selected) return;
		if (await workflowExportTargetExists(selected.fsPath)) {
			await this.post({
				type: 'error',
				message: 'Choose a new file name; workflow exports never overwrite files.',
			});
			return;
		}
		this.destination = { kind: 'file', outputPath: selected.fsPath };
		await this.post({ type: 'destination', kind: 'file', path: selected.fsPath, isDefault: false });
	}

	private async useDefaultDestination(): Promise<void> {
		this.defaultDirectory ??= await editorDataClient.getWorkflowExportDefaultDirectory();
		this.destination = { kind: 'directory' };
		await this.post({ type: 'destination', kind: 'directory', path: this.defaultDirectory, isDefault: true });
	}

	private async startExport(message: Record<string, unknown>): Promise<void> {
		if (this.exportController) {
			await this.post({ type: 'error', message: 'A workflow export is already running.' });
			return;
		}
		const controller = new AbortController();
		this.exportController = controller;
		try {
			const org = this.organization(message.orgId);
			if (!org || this.catalogOrgId !== org.id) {
				await this.post({ type: 'error', message: 'Reload the selected organization before exporting.' });
				return;
			}
			const selectedIds = Array.isArray(message.workflowIds)
				? [...new Set(message.workflowIds.filter((id): id is string => typeof id === 'string'))]
				: [];
			const selectedSet = new Set(selectedIds);
			const workflows = this.catalog.filter(workflow => selectedSet.has(workflow.id));
			if (workflows.length === 0 || workflows.length !== selectedIds.length) {
				await this.post({ type: 'error', message: 'Select at least one workflow from the current catalog.' });
				return;
			}
			const mode: WorkflowExportMode = message.mode === 'separate' ? 'separate' : 'bundle';
			this.defaultDirectory ??= await editorDataClient.getWorkflowExportDefaultDirectory();
			let destination = this.destination;
			if (mode === 'separate' && destination.kind === 'file') {
				destination = { kind: 'directory' };
				this.destination = destination;
				await this.post({
					type: 'destination',
					kind: 'directory',
					path: this.defaultDirectory,
					isDefault: true,
				});
			}
			if (destination.kind === 'file' && workflows.length > MAX_WORKFLOW_EXPORT_BATCH_SIZE) {
				await this.post({
					type: 'error',
					message: 'Choose a folder for exports that require multiple bundle files.',
				});
				return;
			}
			let progressValue = 0;
			await this.post({ type: 'exportStarted', workflowCount: workflows.length, mode });
			const outcome = await runWorkflowExports(
				workflows,
				mode,
				async (workflowIds, batchIndex, batchCount) => {
					const sessionId = await resolveWorkflowExportSessionId(org.id);
					const workflowIdSet = new Set(workflowIds);
					return exportWorkflowBatchToAvailablePath(
						{
							destination,
							defaultDirectory: this.defaultDirectory!,
							mode,
							workflows: workflows.filter(workflow => workflowIdSet.has(workflow.id)),
							batchIndex,
							batchCount,
							useWorkflowNames: mode === 'separate' && message.useWorkflowNames === true,
						},
						outputPath =>
							editorDataClient.exportWorkflows(
								{
									sessionId,
									orgId: org.id,
									workflowIds,
									outputPath,
								},
								{ signal: controller.signal },
							),
					);
				},
				controller.signal,
				(messageText, increment = 0) => {
					progressValue = Math.min(100, progressValue + increment);
					void this.post({ type: 'exportProgress', message: messageText, percent: progressValue });
				},
			);
			const exportedWorkflowCount = outcome.results.reduce(
				(count, result) => count + result.workflowIds.length,
				0,
			);
			for (const result of outcome.results) if (result.outputPath) this.knownOutputPaths.add(result.outputPath);
			await this.post({
				type: 'exportComplete',
				cancelled: outcome.cancelled,
				exportedWorkflowCount,
				fileCount: outcome.results.length,
				outputPaths: outcome.results.flatMap(result => (result.outputPath ? [result.outputPath] : [])),
				failures: outcome.failures.map(failure => ({
					workflowName: failure.workflow?.name,
					workflowId: failure.workflow?.id,
					workflowIds: failure.workflowIds,
					message: failure.message,
				})),
			});
		} catch (error) {
			if (controller.signal.aborted) await this.post({ type: 'exportComplete', cancelled: true, fileCount: 0 });
			else await this.post({ type: 'error', message: `Workflow export failed: ${errorMessage(error)}` });
		} finally {
			if (this.exportController === controller) this.exportController = undefined;
		}
	}

	private async reveal(path: unknown): Promise<void> {
		if (typeof path === 'string' && this.knownOutputPaths.has(path)) {
			await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path));
		}
	}

	private async handleMessage(value: unknown): Promise<void> {
		const message = messageRecord(value);
		if (!message || typeof message.type !== 'string') return;
		try {
			switch (message.type) {
				case 'ready':
					await this.bootstrap();
					break;
				case 'loadCatalog':
					await this.loadCatalog(message.orgId);
					break;
				case 'applyFilters':
					await this.applyFilters(message.filters);
					break;
				case 'chooseFolder':
					await this.chooseFolder();
					break;
				case 'chooseFile':
					await this.chooseFile(message.workflowCount);
					break;
				case 'useDefaultDestination':
					await this.useDefaultDestination();
					break;
				case 'startExport':
					await this.startExport(message);
					break;
				case 'cancelExport':
					this.exportController?.abort();
					break;
				case 'reveal':
					await this.reveal(message.path);
					break;
			}
		} catch (error) {
			log.error('Workflow exporter sidebar failed', error);
			await this.post({ type: 'error', message: errorMessage(error) });
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'workflow-exporter', 'main.css'),
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'workflow-exporter', 'main.js'),
		);
		const nonce = randomBytes(32).toString('base64url');
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Workflow Exporter</title>
</head>
<body>
	<header><h2>Workflow Exporter</h2><p>Filter, select, and export signed workflow bundles.</p></header>
	<section class="panel" aria-labelledby="organization-heading">
		<h3 id="organization-heading">Organization</h3>
		<div class="heading-row"><p id="selectedOrganization" class="muted">Choose an organization</p><button id="changeOrganization" type="button" class="secondary" hidden>Change</button></div>
		<div id="organizationPicker">
			<input id="organizationSearch" type="search" placeholder="Search organizations…" aria-label="Search organizations">
			<div id="organizationList" class="organization-list" role="listbox" aria-label="Organizations"></div>
		</div>
		<div class="row"><button id="refreshCatalog" type="button" title="Refresh workflows">Refresh workflows</button></div>
	</section>
	<section class="panel" aria-labelledby="filters-heading">
		<div class="heading-row"><h3 id="filters-heading">Workflows</h3><span id="catalogCount">0</span></div>
		<input id="workflowSearch" type="search" placeholder="Search name or ID…" aria-label="Search workflows">
		<div class="filter-label"><span>Tags</span><span id="tagSelectionCount" class="muted">All tags</span></div>
		<div class="row"><input id="tagSearch" type="search" placeholder="Find tags…" aria-label="Find tags"><button id="clearTags" type="button" class="secondary">Clear</button></div>
		<div id="tagList" class="tag-list" role="listbox" aria-label="Workflow tags" aria-multiselectable="true"></div>
		<div class="segmented" role="group" aria-label="Tag matching"><label><input type="radio" name="tagMatch" value="any" checked> Any tag</label><label><input type="radio" name="tagMatch" value="all"> All tags</label></div>
		<details><summary>Date filters</summary>
			<div class="date-grid"><label>Created from<input id="createdFrom" type="date"></label><label>Created to<input id="createdTo" type="date"></label><label>Updated from<input id="updatedFrom" type="date"></label><label>Updated to<input id="updatedTo" type="date"></label></div>
		</details>
		<div class="selection-actions"><button id="selectFiltered" type="button">Select visible</button><button id="clearSelection" type="button" class="secondary">Clear selection</button></div>
		<div id="workflowList" class="workflow-list" aria-live="polite"></div>
		<p id="selectionCount" class="muted">0 selected</p>
	</section>
	<section class="panel" aria-labelledby="options-heading">
		<h3 id="options-heading">Export options</h3>
		<div class="segmented vertical"><label><input type="radio" name="mode" value="separate" checked> Separate JSON files</label><label><input type="radio" name="mode" value="bundle"> Signed bundles (25 per file)</label></div>
		<label id="filenameOption"><input id="useWorkflowNames" type="checkbox"> Use workflow names for filenames</label>
		<p class="muted">Names are sanitized and include the workflow ID to prevent duplicate-name collisions.</p>
		<div class="destination"><strong>Destination</strong><span id="destinationPath">Loading…</span></div>
		<div class="destination-actions"><button id="useDefault" type="button" class="secondary">Default</button><button id="chooseFolder" type="button" class="secondary">Choose folder</button><button id="chooseFile" type="button" class="secondary">Choose bundle file</button></div>
	</section>
	<section class="panel actions"><button id="startExport" type="button">Export selected</button><button id="cancelExport" type="button" class="danger" hidden>Cancel</button><progress id="progress" max="100" value="0" hidden></progress><p id="status" role="status"></p><div id="results"></div></section>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
