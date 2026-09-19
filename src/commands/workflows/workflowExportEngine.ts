import { stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve as resolvePath } from 'node:path';
import type { WorkflowExportResult } from '../../../packages/mcp-server/src/capabilities/workflowExportCapability';

/** Rewst's export operation accepts at most this many workflow ids per call. */
export const MAX_WORKFLOW_EXPORT_BATCH_SIZE = 25;

/** Maximum UTF-8 bytes for a portable filesystem path segment. */
export const MAX_WORKFLOW_EXPORT_FILENAME_BYTES = 255;

export interface ExportWorkflowChoice {
	id: string;
	name: string;
	orgId: string;
	orgName: string;
	createdAt?: string | null;
	updatedAt?: string | null;
	tags?: { id?: string | null; name?: string | null }[] | null;
}

export type WorkflowExportMode = 'bundle' | 'separate';

export interface WorkflowExportFailure {
	workflow?: ExportWorkflowChoice;
	workflowIds?: string[];
	message: string;
}

export interface WorkflowExportFlowResult {
	results: WorkflowExportResult[];
	failures: WorkflowExportFailure[];
	cancelled: boolean;
}

export interface WorkflowExportDestination {
	outputPath?: string;
	kind: 'directory' | 'file';
}

type Exporter = (workflowIds: string[], batchIndex: number, batchCount: number) => Promise<WorkflowExportResult>;
type ProgressReporter = (message: string, increment?: number) => void;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function batches<T>(items: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
	return result;
}

/** Runs every selected export while keeping each backend request within Rewst's limit. */
export async function runWorkflowExports(
	workflows: readonly ExportWorkflowChoice[],
	mode: WorkflowExportMode,
	exporter: Exporter,
	signal: AbortSignal,
	report: ProgressReporter = () => {},
): Promise<WorkflowExportFlowResult> {
	if (workflows.length === 0) return { results: [], failures: [], cancelled: false };

	if (mode === 'bundle') {
		const workflowBatches = batches(workflows, MAX_WORKFLOW_EXPORT_BATCH_SIZE);
		const results: WorkflowExportResult[] = [];
		const failures: WorkflowExportFailure[] = [];
		for (const [index, workflowBatch] of workflowBatches.entries()) {
			if (signal.aborted) return { results, failures, cancelled: true };
			const batchLabel = workflowBatches.length === 1 ? '' : ` batch ${index + 1}/${workflowBatches.length}`;
			report(`Bundling${batchLabel} ${workflowBatch.length} workflow${workflowBatch.length === 1 ? '' : 's'}…`);
			try {
				results.push(
					await exporter(
						workflowBatch.map(workflow => workflow.id),
						index,
						workflowBatches.length,
					),
				);
			} catch (error) {
				if (signal.aborted) return { results, failures, cancelled: true };
				failures.push({
					workflowIds: workflowBatch.map(workflow => workflow.id),
					message: errorMessage(error),
				});
			}
			report(
				`${Math.min((index + 1) * MAX_WORKFLOW_EXPORT_BATCH_SIZE, workflows.length)} of ${workflows.length} complete`,
				(100 * workflowBatch.length) / workflows.length,
			);
		}
		return { results, failures, cancelled: false };
	}

	const results: WorkflowExportResult[] = [];
	const failures: WorkflowExportFailure[] = [];
	const increment = 100 / workflows.length;
	for (const [index, workflow] of workflows.entries()) {
		if (signal.aborted) return { results, failures, cancelled: true };
		report(`Exporting ${workflow.name} (${index + 1}/${workflows.length})…`);
		try {
			results.push(await exporter([workflow.id], index, workflows.length));
		} catch (error) {
			if (signal.aborted) return { results, failures, cancelled: true };
			failures.push({ workflow, message: errorMessage(error) });
		}
		report(`${index + 1} of ${workflows.length} complete`, increment);
	}
	return { results, failures, cancelled: false };
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function truncateByUtf8Bytes(value: string, maxBytes: number): string {
	if (maxBytes <= 0) return '';
	if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
	let result = '';
	let usedBytes = 0;
	for (const character of value) {
		const characterBytes = Buffer.byteLength(character, 'utf8');
		if (usedBytes + characterBytes > maxBytes) break;
		result += character;
		usedBytes += characterBytes;
	}
	return result;
}

function fitFilenamePart(value: string, maxBytes: number, fallback = 'workflow'): string {
	const fitted = truncateByUtf8Bytes(value, maxBytes).replace(/[. ]+$/g, '');
	if (fitted) return fitted;
	return truncateByUtf8Bytes(fallback, maxBytes).replace(/[. ]+$/g, '') || 'w';
}

/** Produces one portable path segment while retaining readable workflow names. */
export function sanitizeWorkflowFilenamePart(value: string, maxLength = 150): string {
	let safe = [...value.normalize('NFKC')]
		.filter(character => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 0x1f && codePoint !== 0x7f;
		})
		.join('')
		.replace(/[<>:"/\\|?*]/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/-+/g, '-')
		.trim()
		.replace(/^[. ]+|[. ]+$/g, '');
	if (!safe || safe === '.' || safe === '..') safe = 'workflow';
	if (WINDOWS_RESERVED_NAME.test(safe)) safe = `_${safe}`;
	return (
		[...safe]
			.slice(0, maxLength)
			.join('')
			.replace(/[. ]+$/g, '') || 'workflow'
	);
}

/** Names separate exports by id or, when opted in, by readable name plus a collision-safe workflow id. */
export function separateWorkflowExportFilename(
	workflow: Pick<ExportWorkflowChoice, 'id' | 'name'>,
	useWorkflowNames: boolean,
): string {
	const extension = '.json';
	const sanitizedId = sanitizeWorkflowFilenamePart(workflow.id, 80);
	if (!useWorkflowNames) {
		const prefix = 'rewst-workflow-';
		const id = fitFilenamePart(
			sanitizedId,
			MAX_WORKFLOW_EXPORT_FILENAME_BYTES - Buffer.byteLength(`${prefix}${extension}`, 'utf8'),
		);
		return `${prefix}${id}${extension}`;
	}

	const separator = '--';
	const fallbackName = 'workflow';
	const id = fitFilenamePart(
		sanitizedId,
		MAX_WORKFLOW_EXPORT_FILENAME_BYTES - Buffer.byteLength(`${fallbackName}${separator}${extension}`, 'utf8'),
	);
	const name = fitFilenamePart(
		sanitizeWorkflowFilenamePart(workflow.name),
		MAX_WORKFLOW_EXPORT_FILENAME_BYTES - Buffer.byteLength(`${separator}${id}${extension}`, 'utf8'),
		fallbackName,
	);
	return `${name}${separator}${id}${extension}`;
}

export function workflowExportOutputPath(
	destination: WorkflowExportDestination,
	defaultDirectory: string,
	mode: WorkflowExportMode,
	workflows: readonly Pick<ExportWorkflowChoice, 'id' | 'name'>[],
	batchIndex: number,
	batchCount: number,
	useWorkflowNames = false,
): string | undefined {
	if (destination.kind === 'file') return destination.outputPath;
	const directory = destination.outputPath ?? defaultDirectory;
	if (mode === 'bundle') {
		return join(
			directory,
			`rewst-workflows-batch-${String(batchIndex + 1).padStart(3, '0')}-of-${String(batchCount).padStart(3, '0')}.json`,
		);
	}
	const workflow = workflows[0] ?? { id: 'workflow', name: 'workflow' };
	return join(directory, separateWorkflowExportFilename(workflow, useWorkflowNames));
}

type PathExists = (path: string) => Promise<boolean>;

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
		throw error;
	}
}

/**
 * Keeps the established directory-export filename when available and otherwise
 * chooses the first deterministic numeric suffix. Explicit file destinations
 * are validated by the picker and remain verbatim.
 */
export async function resolveWorkflowExportOutputPath(
	destination: WorkflowExportDestination,
	defaultDirectory: string,
	mode: WorkflowExportMode,
	workflows: readonly Pick<ExportWorkflowChoice, 'id' | 'name'>[],
	batchIndex: number,
	batchCount: number,
	useWorkflowNames = false,
	exists: PathExists = pathExists,
): Promise<string | undefined> {
	const outputPath = workflowExportOutputPath(
		destination,
		defaultDirectory,
		mode,
		workflows,
		batchIndex,
		batchCount,
		useWorkflowNames,
	);
	if (!outputPath || destination.kind === 'file' || !(await exists(outputPath))) return outputPath;

	const directory = dirname(outputPath);
	const extension = extname(outputPath);
	const filename = basename(outputPath);
	const stem = filename.slice(0, filename.length - extension.length);
	for (let suffix = 2; ; suffix++) {
		const suffixText = `-${suffix}`;
		const fittedStem = fitFilenamePart(
			stem,
			MAX_WORKFLOW_EXPORT_FILENAME_BYTES - Buffer.byteLength(`${suffixText}${extension}`, 'utf8'),
		);
		const candidate = join(directory, `${fittedStem}${suffixText}${extension}`);
		if (!(await exists(candidate))) return candidate;
	}
}

export interface WorkflowExportPathRequest {
	destination: WorkflowExportDestination;
	defaultDirectory: string;
	mode: WorkflowExportMode;
	workflows: readonly Pick<ExportWorkflowChoice, 'id' | 'name'>[];
	batchIndex: number;
	batchCount: number;
	useWorkflowNames?: boolean;
}

const directoryExportQueues = new Map<string, Promise<void>>();

function serializeDirectoryExport<T>(directory: string, operation: () => Promise<T>): Promise<T> {
	const key = resolvePath(directory);
	const previous = directoryExportQueues.get(key) ?? Promise.resolve();
	const result = previous.then(operation, operation);
	const settled = result.then(
		() => undefined,
		() => undefined,
	);
	directoryExportQueues.set(key, settled);
	void settled.then(() => {
		if (directoryExportQueues.get(key) === settled) directoryExportQueues.delete(key);
	});
	return result;
}

/**
 * Resolves and publishes a directory export as one serialized operation so
 * command and sidebar callers cannot select the same available filename.
 * Explicit file destinations remain verbatim and rely on backend no-overwrite
 * publication for their final atomic safeguard.
 */
export async function exportWorkflowBatchToAvailablePath<T>(
	request: WorkflowExportPathRequest,
	exporter: (outputPath: string | undefined) => Promise<T>,
	exists: PathExists = pathExists,
): Promise<T> {
	const run = async (): Promise<T> => {
		const outputPath = await resolveWorkflowExportOutputPath(
			request.destination,
			request.defaultDirectory,
			request.mode,
			request.workflows,
			request.batchIndex,
			request.batchCount,
			request.useWorkflowNames,
			exists,
		);
		return exporter(outputPath);
	};

	if (request.destination.kind === 'file') return run();
	return serializeDirectoryExport(request.destination.outputPath ?? request.defaultDirectory, run);
}
