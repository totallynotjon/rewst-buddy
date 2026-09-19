import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { runExportObjects, type ExportTransportOptions } from '../export/exportClient';
import {
	DEFAULT_EXPORT_INACTIVITY_TIMEOUT_MS,
	MAX_EXPORT_INACTIVITY_TIMEOUT_MS,
	MIN_EXPORT_INACTIVITY_TIMEOUT_MS,
	redactExportError,
	type ExportBundle,
	type ExportObjectsSuccess,
} from '../export/exportObjects';
import { LocalExportStorage, ensureDefaultExportDir, type ExportStorage } from '../export/exportStorage';
import { toCookieHeader } from '../sessions/graphqlWsTransport';
import type { ToolSpecDefinition } from '../tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import { json, ORG_ID_FIELD, parseCapabilityInput, rawGraphqlOrThrow, toInputSchema } from './inputHelpers';

const WORKFLOW_OWNER_QUERY = `
query RewstBuddyWorkflowOwner($id: ID!) {
  workflow(where: { id: $id }) { id name orgId }
}
`.trim();

interface WorkflowOwner {
	id?: unknown;
	name?: unknown;
	orgId?: unknown;
}

type ExportTransport = (options: ExportTransportOptions) => Promise<ExportObjectsSuccess>;

let exportTransport: ExportTransport = runExportObjects;
let exportStorage: ExportStorage = new LocalExportStorage();
let defaultExportDir: () => Promise<string> = ensureDefaultExportDir;

/** Upper bound on workflows per export; keeps per-id owner checks and the bundle bounded. */
export const MAX_WORKFLOWS_PER_EXPORT = 25;

/** Host-owned limits forwarded to editor clients when bootstrapping workflow export UI. */
export const WORKFLOW_EXPORT_BOOTSTRAP_PAYLOAD = Object.freeze({
	maxWorkflowsPerExport: MAX_WORKFLOWS_PER_EXPORT,
});

/** Structured result shared by MCP text responses and trusted editor operations. */
export interface WorkflowExportResult {
	status: 'saved';
	orgId: string;
	workflowIds: string[];
	recommendedFilename: string;
	outputPath: string | null;
	bytes: number;
	version: number;
	exportedAt: string;
	objectCount: number;
	signingPresent: boolean;
	bundle?: ExportBundle;
}

/** Replaces external boundaries in unit tests; omit either argument to restore it. */
export function _setWorkflowExportDependenciesForTesting(dependencies?: {
	transport?: ExportTransport;
	storage?: ExportStorage;
	defaultDir?: () => Promise<string>;
}): void {
	exportTransport = dependencies?.transport ?? runExportObjects;
	exportStorage = dependencies?.storage ?? new LocalExportStorage();
	defaultExportDir = dependencies?.defaultDir ?? ensureDefaultExportDir;
}

const workflowExportInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	workflowIds: z
		.array(z.string().trim().min(1, { error: 'workflowIds cannot contain empty ids.' }), {
			error: '"workflowIds" must be a non-empty array of workflow id strings.',
		})
		.min(1, { error: '"workflowIds" must contain at least one workflow id.' })
		.max(MAX_WORKFLOWS_PER_EXPORT, {
			error: `"workflowIds" must contain at most ${MAX_WORKFLOWS_PER_EXPORT} workflow ids.`,
		})
		.describe(
			`One or more workflow ids to export, up to ${MAX_WORKFLOWS_PER_EXPORT}. Values are trimmed and duplicates are removed.`,
		),
	outputPath: z
		.string()
		.trim()
		.min(1)
		.refine(isAbsolute, { error: '"outputPath" must be an absolute file or directory path.' })
		.optional()
		.describe(
			'Optional absolute local file path or existing directory. When omitted the bundle is saved to the default export directory instead of only returning inline.',
		),
	overwrite: z
		.literal(false, {
			error: 'buddy_export_workflows is read-only and cannot overwrite an existing local file; choose a new outputPath.',
		})
		.optional()
		.default(false)
		.describe('Must remain false. This read capability never replaces an existing local file.'),
	includeBundle: z
		.boolean()
		.optional()
		.default(false)
		.describe('Include the full bundle in the result when outputPath is supplied.'),
	timeoutMs: z
		.number()
		.int()
		.min(MIN_EXPORT_INACTIVITY_TIMEOUT_MS)
		.max(MAX_EXPORT_INACTIVITY_TIMEOUT_MS)
		.optional()
		.default(DEFAULT_EXPORT_INACTIVITY_TIMEOUT_MS)
		.describe(
			`WebSocket stream inactivity timeout in milliseconds (${MIN_EXPORT_INACTIVITY_TIMEOUT_MS}-${MAX_EXPORT_INACTIVITY_TIMEOUT_MS}); resets on every stream event.`,
		),
});

function uniqueWorkflowIds(workflowIds: readonly string[]): string[] {
	return [...new Set(workflowIds.map(id => id.trim()))];
}

async function validateWorkflowOwners(
	workflowIds: readonly string[],
	orgId: string,
	ctx: CapabilityContext,
	redactionSecrets: readonly string[],
): Promise<void> {
	for (const workflowId of workflowIds) {
		throwIfCancelled(ctx.signal);
		let data: unknown;
		try {
			data = await rawGraphqlOrThrow(
				ctx.session,
				WORKFLOW_OWNER_QUERY,
				{ id: workflowId },
				{ signal: ctx.signal },
			);
		} catch (error) {
			throwIfCancelled(ctx.signal);
			throw new Error(redactExportError(error, redactionSecrets));
		}
		throwIfCancelled(ctx.signal);
		const workflow = (data as { workflow?: WorkflowOwner | null } | null | undefined)?.workflow;
		if (!workflow || workflow.id !== workflowId || workflow.orgId !== orgId) {
			throw new Error(`Workflow ${workflowId} was not found in org ${orgId}.`);
		}
	}
}

function bundleObjectCount(bundle: ExportBundle): number {
	if (Array.isArray(bundle.objects)) return bundle.objects.length;
	if (bundle.objects && typeof bundle.objects === 'object') return Object.keys(bundle.objects).length;
	return 0;
}

function signingPresent(bundle: ExportBundle): boolean {
	return bundle.signing !== null && bundle.signing !== undefined;
}

function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error('Workflow export was cancelled.');
}

async function runWorkflowExport(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	throwIfCancelled(ctx.signal);
	const parsed = parseCapabilityInput(workflowExportInputSchema, input);
	const workflowIds = uniqueWorkflowIds(parsed.workflowIds);
	const storedCookie = await ctx.session.getCookies();
	throwIfCancelled(ctx.signal);
	const cookieHeader = toCookieHeader(storedCookie, ctx.session.profile.region);
	const redactionSecrets = storedCookie === cookieHeader ? [cookieHeader] : [storedCookie, cookieHeader];

	// Every id is checked over HTTP before the websocket is created. This fails
	// closed for both unknown ids and resources belonging to another organization.
	await validateWorkflowOwners(workflowIds, parsed.orgId, ctx, redactionSecrets);
	throwIfCancelled(ctx.signal);

	const outcome = await exportTransport({
		session: ctx.session,
		workflowIds,
		inactivityTimeoutMs: parsed.timeoutMs,
		signal: ctx.signal,
	});
	throwIfCancelled(ctx.signal);
	const contents = JSON.stringify(outcome.bundle, null, 2);
	const bundleBytes = Buffer.byteLength(contents, 'utf8');
	// Every export lands on disk: an explicit outputPath wins, otherwise the
	// configurable default directory (Downloads/Rewst Exports unless
	// rewst-buddy.mcp.exportDefaultDir overrides it).
	const destination = parsed.outputPath ?? (await defaultExportDir());
	throwIfCancelled(ctx.signal);
	const saved = await exportStorage.save({
		outputPath: destination,
		recommendedFilename: outcome.recommendedFilename,
		contents,
		overwrite: false,
		signal: ctx.signal,
	});
	throwIfCancelled(ctx.signal);

	const result: WorkflowExportResult = {
		status: 'saved',
		orgId: parsed.orgId,
		workflowIds,
		recommendedFilename: outcome.recommendedFilename,
		outputPath: saved?.outputPath ?? null,
		bytes: saved?.bytes ?? bundleBytes,
		version: outcome.bundle.version,
		exportedAt: outcome.bundle.exportedAt,
		objectCount: bundleObjectCount(outcome.bundle),
		signingPresent: signingPresent(outcome.bundle),
	};
	// The bundle stays inline unless an explicit outputPath opts out of the
	// duplication (pass includeBundle to keep it). Oversized results remain
	// pageable through buddy_result_read.
	if (parsed.outputPath === undefined || parsed.includeBundle) result.bundle = outcome.bundle;
	return json(result);
}

const spec: ToolSpecDefinition = {
	name: 'buddy_export_workflows',
	description:
		"Export one or more workflows through the same signed exportObjects subscription as Rewst's web Export button. The Rewst operation is read-only. Every export is also saved to disk as pretty JSON: pass an absolute outputPath under an approved local root (Downloads, an active workspace, the current Git checkout, or rewst-buddy.mcp.exportRoots) to choose the destination, or omit it to use the default export directory (Downloads/Rewst Exports unless rewst-buddy.mcp.exportDefaultDir overrides it). An existing directory saves under Rewst's sanitized recommended filename; pointing at the Downloads folder itself saves inside a Rewst Exports subfolder, created when missing. Without an explicit outputPath the complete signed bundle is still returned inline (large results can be paged with buddy_result_read); with one it is opt-in via includeBundle. Canonical path checks prevent traversal and symlink escapes; local writes are atomic and never replace an existing file.",
	inputSchema: toInputSchema(workflowExportInputSchema),
};

export const workflowExportCapability: Capability = readCapability(spec, runWorkflowExport);
