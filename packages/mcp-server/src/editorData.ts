/**
 * Data operations used by the editor UI.  The editor invokes these by name
 * through the host bridge; sessions and GraphQL stay inside the standalone
 * package so editor modules never carry credentials or transport code.
 */

import {
	buildUnpackInput,
	parseCrateDetail,
	type CrateDetail,
	type TokenValues,
	type UnpackSuccess,
} from './crates/crateUnpack';
import { runUnpackCrate } from './crates/unpackClient';
import { workflowExportCapability, type WorkflowExportResult } from './capabilities/workflowExportCapability';
import { ensureDefaultExportDir } from './export/exportStorage';
import type { RuntimeHost } from './host';
import { SessionManager } from './sessions/index';
import type Session from './sessions/Session';
import { createGraphqlDeps } from './tools/graphqlTool';
import { evaluateRenderJinja, type ExecutionRow } from './workflow/executions';
import { firstErrorMessage, isPlainObject } from './workflow/types';

export interface EditorOperationContext {
	signal: AbortSignal;
	emit(event: unknown): Promise<void>;
}

export interface JinjaFilterDoc {
	name: string;
	signature?: string;
	documentation: string;
}

export interface JinjaRenderInput {
	sessionId: string;
	orgId: string;
	template: string;
	vars: Record<string, unknown>;
}

export interface PreviewWorkflowRow {
	id?: string | null;
	name?: string | null;
	orgId?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
	tags?: { id?: string | null; name?: string | null }[] | null;
}

const WORKFLOWS_QUERY = `query RewstBuddyPreviewWorkflows($orgId: ID!, $limit: Int, $offset: Int) {
	workflows(where: { orgId: $orgId }, limit: $limit, offset: $offset, order: [["name", "asc"]]) {
		id
		name
		orgId
		createdAt
		updatedAt
		tags { id name }
	}
}`;

const WORKFLOW_EXECUTIONS_QUERY = `query RewstBuddyExecutions($where: WorkflowExecutionWhereInput, $order: [[String!]!], $limit: Int) {
	workflowExecutions(where: $where, order: $order, limit: $limit) {
		id status createdAt numSuccessfulTasks orgId originatingExecutionId parentExecutionId
	}
}`;

const EXECUTION_CONTEXTS_QUERY = `query RewstBuddyExecutionContexts($id: ID!) {
	workflowExecutionContexts(workflowExecutionId: $id)
}`;

const EXECUTION_OWNER_QUERY = `query RewstBuddyExecutionOwner($where: WorkflowExecutionWhereInput) {
	workflowExecution(where: $where) {
		id orgId
	}
}`;

const CRATE_LIST_QUERY = `query RewstBuddyCrateList($orgId: ID, $limit: Int) {
	crates(selectedOrgId: $orgId, limit: $limit) {
		id name category description isUnpackedForSelectedOrg
	}
}`;

const CRATE_DETAIL_QUERY = `query RewstBuddyCrateDetail($crateId: ID, $orgId: ID) {
	crate(selectedOrgId: $orgId, where: { id: $crateId }) {
		id name description requiredOrgVariables isUnpackedForSelectedOrg
		workflow { name humanSecondsSaved }
		tokens {
			id name type index value isMultiselect previewText emptyLabel
			options { id label value isDefault }
		}
		crateTriggers {
			id
			trigger { id name criteria autoActivateManagedOrgs }
		}
	}
}`;

const FILTERS_PATH = '/jinja/intellisense/filters';
const WORKFLOW_PICK_LIMIT = 500;
const WORKFLOW_PICK_MAX_PAGES = 100;
const CRATE_LIST_LIMIT = 500;
const filterCache = new Map<string, JinjaFilterDoc[]>();

function engineBaseFromRegion(graphqlUrl: string | undefined): string {
	if (typeof graphqlUrl !== 'string') return 'https://engine.rewst.io';
	try {
		const url = new URL(graphqlUrl);
		return url.host.startsWith('api.') ? `${url.protocol}//engine.${url.host.slice(4)}` : 'https://engine.rewst.io';
	} catch {
		return 'https://engine.rewst.io';
	}
}

function parseJinjaFilters(payload: unknown): JinjaFilterDoc[] {
	if (!Array.isArray(payload)) throw new Error('Unexpected Jinja filter payload: expected a JSON array.');
	const filters: JinjaFilterDoc[] = [];
	for (const item of payload) {
		if (!item || typeof item !== 'object') continue;
		const record = item as Record<string, unknown>;
		const label = record.label;
		const labelRecord = label && typeof label === 'object' ? (label as Record<string, unknown>) : undefined;
		const name = (typeof label === 'string' ? label : (labelRecord?.label ?? record.insertText)) as unknown;
		if (typeof name !== 'string' || name.length === 0) continue;
		const documentation = record.documentation;
		filters.push({
			name,
			signature: typeof labelRecord?.detail === 'string' ? labelRecord.detail : undefined,
			documentation:
				typeof documentation === 'string'
					? documentation
					: documentation &&
						  typeof documentation === 'object' &&
						  typeof (documentation as { value?: unknown }).value === 'string'
						? (documentation as { value: string }).value
						: '',
		});
	}
	return filters.sort((a, b) => a.name.localeCompare(b.name));
}

function inputString(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing required string argument "${key}".`);
	return value.trim();
}

function inputOrg(input: Record<string, unknown>): string {
	return inputString(input, 'orgId');
}

function inputSessionId(input: Record<string, unknown>): string {
	return inputString(input, 'sessionId');
}

function unpackStreamId(input: Record<string, unknown>): string {
	const supplied = input.streamId;
	if (typeof supplied === 'string' && supplied.trim() !== '') return supplied.trim();
	return `crate-unpack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sessionUserId(session: Session): string | undefined {
	const id = session.profile?.user?.id;
	return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function sessionOwnsOrg(session: Session, orgId: string): boolean {
	return session.profile.org.id === orgId || (session.profile.allManagedOrgs ?? []).some(org => org.id === orgId);
}

/** Resolves the caller's selected session and verifies its org scope. */
async function requireSession(input: Record<string, unknown>, requireOrg = true): Promise<Session> {
	const sessionId = inputSessionId(input);
	const orgId = requireOrg ? inputOrg(input) : undefined;
	let session = SessionManager.sessionMap.get(sessionId);
	if (!session && orgId) {
		try {
			session = await SessionManager.getSessionForOrg(orgId);
		} catch {
			throw new Error(`No active session found for sessionId "${sessionId}".`);
		}
		if (sessionUserId(session) !== sessionId) {
			throw new Error(`Session "${sessionId}" is not active for organization "${orgId}".`);
		}
	}
	if (!session) throw new Error(`No active session found for sessionId "${sessionId}".`);
	if (!(await session.ensureValid())) throw new Error(`Session "${sessionId}" is expired or unavailable.`);
	if (orgId && !sessionOwnsOrg(session, orgId)) {
		throw new Error(`Session "${sessionId}" does not manage organization "${orgId}".`);
	}
	return session;
}

async function execute(
	session: Session,
	query: string,
	variables: Record<string, unknown>,
	options?: { signal?: AbortSignal },
): Promise<unknown> {
	const result = await session.rawGraphql(query, variables, options);
	const error = firstErrorMessage(result);
	if (error) throw new Error(error);
	return result.data;
}

async function renderJinja(input: Record<string, unknown>): Promise<unknown> {
	const session = await requireSession(input);
	const template = input.template;
	if (typeof template !== 'string') throw new Error('Argument "template" must be a string.');
	const vars = input.vars;
	if (!isPlainObject(vars)) throw new Error('Argument "vars" must be an object.');
	return evaluateRenderJinja(createGraphqlDeps(session), inputOrg(input), template, vars);
}

async function getJinjaFilters(
	input: Record<string, unknown>,
	context?: EditorOperationContext,
): Promise<JinjaFilterDoc[]> {
	const session = await requireSession(input, false);
	const sessionId = inputSessionId(input);
	const cached = filterCache.get(sessionId);
	if (cached) return cached;
	const base = engineBaseFromRegion(session.profile.region?.graphqlUrl);
	const response = await fetch(`${base}${FILTERS_PATH}`, { signal: context?.signal });
	if (!response.ok)
		throw new Error(`Failed to fetch Jinja filter docs: HTTP ${response.status} ${response.statusText}`);
	const filters = parseJinjaFilters(await response.json());
	filterCache.set(sessionId, filters);
	return filters;
}

async function previewWorkflows(
	input: Record<string, unknown>,
	context?: EditorOperationContext,
): Promise<PreviewWorkflowRow[]> {
	const session = await requireSession(input);
	const orgId = inputOrg(input);
	const rows: PreviewWorkflowRow[] = [];
	for (let page = 0; page < WORKFLOW_PICK_MAX_PAGES; page++) {
		const pageRows =
			(
				(await execute(
					session,
					WORKFLOWS_QUERY,
					{
						orgId,
						limit: WORKFLOW_PICK_LIMIT,
						offset: page * WORKFLOW_PICK_LIMIT,
					},
					{ signal: context?.signal },
				)) as { workflows?: (PreviewWorkflowRow | null)[] } | undefined
			)?.workflows ?? [];
		const usable = pageRows.filter((row): row is PreviewWorkflowRow => !!row?.id);
		rows.push(...usable);
		if (pageRows.length < WORKFLOW_PICK_LIMIT) break;
	}
	return rows;
}

async function exportWorkflows(
	input: Record<string, unknown>,
	context: EditorOperationContext,
): Promise<WorkflowExportResult> {
	const session = await requireSession(input);
	const orgId = inputOrg(input);
	const outputPath = input.outputPath ?? (await ensureDefaultExportDir());
	const serialized = await workflowExportCapability.run(
		{ ...input, outputPath, includeBundle: false },
		{
			session,
			orgId,
			sessions: SessionManager.getActiveSessions(),
			signal: context.signal,
		},
	);
	const result: unknown = JSON.parse(serialized);
	if (!isPlainObject(result) || result.status !== 'saved') {
		throw new Error('Workflow export returned an unexpected result.');
	}
	return result as unknown as WorkflowExportResult;
}

async function previewExecutions(input: Record<string, unknown>): Promise<ExecutionRow[]> {
	const session = await requireSession(input);
	const workflowId = inputString(input, 'workflowId');
	const orgId = inputOrg(input);
	const read = async (where: Record<string, string>): Promise<ExecutionRow[]> => {
		const data = (await execute(session, WORKFLOW_EXECUTIONS_QUERY, {
			where,
			order: [['createdAt', 'desc']],
			limit: 20,
		})) as { workflowExecutions?: (ExecutionRow | null)[] } | undefined;
		return (data?.workflowExecutions ?? []).filter((row): row is ExecutionRow => !!row);
	};
	const scoped = await read({ workflowId, orgId });
	return scoped.length > 0 ? scoped : read({ workflowId });
}

async function previewContext(input: Record<string, unknown>): Promise<Record<string, unknown>> {
	const session = await requireSession(input);
	const executionId = inputString(input, 'executionId');
	const orgId = inputOrg(input);
	const ownerData = await execute(session, EXECUTION_OWNER_QUERY, { where: { id: executionId, orgId } });
	const owner = (ownerData as { workflowExecution?: { id?: unknown; orgId?: unknown } | null } | undefined)
		?.workflowExecution;
	if (!owner || owner.id !== executionId || owner.orgId !== orgId) {
		throw new Error(`Execution "${executionId}" is not available in organization "${orgId}".`);
	}
	const data = await execute(session, EXECUTION_CONTEXTS_QUERY, { id: executionId });
	const raw = (data as { workflowExecutionContexts?: unknown } | undefined)?.workflowExecutionContexts;
	const snapshots = Array.isArray(raw) ? raw : raw ? [raw] : [];
	if (snapshots.length === 0) throw new Error(`Execution ${executionId} has no context to render against.`);
	return Object.assign({}, ...snapshots.filter(isPlainObject)) as Record<string, unknown>;
}

async function listCrates(input: Record<string, unknown>): Promise<unknown[]> {
	const session = await requireSession(input);
	const data = (await execute(session, CRATE_LIST_QUERY, { orgId: inputOrg(input), limit: CRATE_LIST_LIMIT })) as
		| { crates?: unknown[] | null }
		| undefined;
	return data?.crates ?? [];
}

async function detailCrate(input: Record<string, unknown>): Promise<CrateDetail | null> {
	const session = await requireSession(input);
	const data = await execute(session, CRATE_DETAIL_QUERY, {
		crateId: inputString(input, 'crateId'),
		orgId: inputOrg(input),
	});
	return parseCrateDetail(data) ?? null;
}

async function unpackCrate(input: Record<string, unknown>, context: EditorOperationContext): Promise<UnpackSuccess> {
	const session = await requireSession(input);
	const crateId = inputString(input, 'crateId');
	const orgId = inputOrg(input);
	const data = await execute(session, CRATE_DETAIL_QUERY, { crateId, orgId });
	const crate = parseCrateDetail(data);
	if (!crate) throw new Error(`Crate ${crateId} was not found or is not visible to this session.`);
	const tokenValues = isPlainObject(input.tokenValues) ? (input.tokenValues as TokenValues) : {};
	const unpackInput = buildUnpackInput(crate, {
		orgId,
		workflowName: typeof input.workflowName === 'string' ? input.workflowName || undefined : undefined,
		tokenValues,
		enableTriggers: input.enableTriggers === true,
	});
	const streamId = unpackStreamId(input);
	const emitted: Promise<void>[] = [];
	const result = await runUnpackCrate({
		session,
		input: unpackInput,
		signal: context.signal,
		onProgress: label => {
			emitted.push(context.emit({ type: 'progress', streamId, label }));
		},
	});
	await Promise.all(emitted);
	return result;
}

export const editorDataOperations: Record<
	string,
	(input: Record<string, unknown>, context: EditorOperationContext) => Promise<unknown>
> = {
	'jinja.render': input => renderJinja(input),
	'jinja.filters': getJinjaFilters,
	'preview.workflows': (input, context) => previewWorkflows(input, context),
	'preview.executions': input => previewExecutions(input),
	'preview.context': input => previewContext(input),
	'workflows.export.catalog': (input, context) => previewWorkflows(input, context),
	'workflows.export.defaultDirectory': async () => ensureDefaultExportDir(),
	'workflows.export.run': exportWorkflows,
	'crates.list': input => listCrates(input),
	'crates.detail': input => detailCrate(input),
	'crates.unpack': unpackCrate,
};

export function clearEditorDataCachesForTesting(): void {
	filterCache.clear();
}

/** Keep host imports explicit in this module's public boundary for embedders. */
export type { RuntimeHost };
