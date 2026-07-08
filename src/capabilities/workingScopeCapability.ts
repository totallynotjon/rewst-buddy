import { WorkingScopeManager } from '@models';
import type { Session } from '@sessions';
import { rawGraphqlOrThrow } from './inputHelpers';
import { readMcpSettings } from '../mcp/settings';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import { currentApprovalOrigin, type ApprovalOrigin } from './approvalOrigin';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';

/**
 * Read and request changes to the user's working scope (see WorkingScopeManager).
 * `buddy_get_working_scope` lets a model or external client see what it is allowed to
 * operate on; `buddy_set_working_scope` lets it *request* a change, which only takes
 * effect after the user confirms a VS Code modal. Setting the scope is not itself
 * a Rewst write, so it stays available regardless of the write-tool toggles —
 * otherwise you could not narrow scope before enabling writes.
 */

/** An org named in a working-scope change request, with its display name when known. */
export interface NamedOrg {
	id: string;
	name: string;
}

/** A workflow named in a working-scope change request, with its resolved display name. */
export interface NamedWorkflow {
	id: string;
	name: string;
	orgId?: string;
}

/** A requested working-scope change, surfaced to the VS Code approval modal. */
export interface WorkingScopeChangeRequest {
	orgs: NamedOrg[];
	workflows: NamedWorkflow[];
	replace: boolean;
}

export type WorkingScopeApprover = (request: WorkingScopeChangeRequest, origin: ApprovalOrigin) => Promise<boolean>;

export interface WorkingScopeApprovalText {
	message: string;
	detail: string;
}

// Defaults to reject so a misconfigured host never silently widens scope.
let approver: WorkingScopeApprover = async () => false;

export function setWorkingScopeApprover(fn: WorkingScopeApprover): void {
	approver = fn;
}

export function _resetWorkingScopeApproverForTesting(): void {
	approver = async () => false;
}

function requestWorkingScopeApproval(request: WorkingScopeChangeRequest): Promise<boolean> {
	return approver(request, currentApprovalOrigin());
}

function toIdArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of value) {
		const trimmed = typeof entry === 'string' ? entry.trim() : '';
		if (trimmed.length === 0 || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

/** Every org id the active sessions manage, mapped to its display name. */
function managedOrgs(sessions: Session[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const session of sessions) {
		const { org, allManagedOrgs } = session.profile;
		if (org?.id) map.set(org.id, org.name ?? org.id);
		for (const managed of allManagedOrgs ?? []) {
			if (managed?.id) map.set(managed.id, managed.name ?? managed.id);
		}
	}
	return map;
}

function currentScope(): { orgs: string[]; workflows: string[] } {
	return { orgs: WorkingScopeManager.getOrgs(), workflows: WorkingScopeManager.getWorkflows() };
}

function formatNamedOrg(org: NamedOrg): string {
	return `${org.name} (${org.id})`;
}

function formatNamedWorkflow(wf: NamedWorkflow): string {
	return `${wf.name} (${wf.id})`;
}

export function workingScopeApprovalText(
	request: WorkingScopeChangeRequest,
	origin: ApprovalOrigin,
): WorkingScopeApprovalText {
	const requester = origin === 'chat' ? 'Cage-Free Rewsty' : 'An external MCP client';
	const verb = request.replace ? 'set' : 'add to';
	const targets = [...request.orgs.map(formatNamedOrg), ...request.workflows.map(formatNamedWorkflow)];
	const targetSummary = targets.length > 0 ? targets.join(', ') : 'the requested targets';
	const detailParts: string[] = [];
	if (request.orgs.length > 0) detailParts.push(`Orgs: ${request.orgs.map(formatNamedOrg).join(', ')}`);
	if (request.workflows.length > 0)
		detailParts.push(`Workflows: ${request.workflows.map(formatNamedWorkflow).join(', ')}`);
	return {
		message: `${requester} wants to ${verb} the working scope for ${targetSummary}. Tools will then be allowed to operate within it.`,
		detail: detailParts.join('\n'),
	};
}

const getWorkingScopeSpec: ToolSpec = {
	name: 'buddy_get_working_scope',
	args: '{}',
	description:
		'Report the current working scope: the orgs and workflows that Rewst tools are allowed to operate on right now, the read scope mode, and the always-allowed orgs. Tool calls outside this scope are rejected by the VS Code extension.',
	inputSchema: { type: 'object', properties: {} },
};

const setWorkingScopeSpec: ToolSpec = {
	name: 'buddy_set_working_scope',
	args: '{"orgs"?: string[], "workflows"?: string[], "replace"?: boolean}',
	description:
		'Request a change to the working scope (the orgs/workflows tools may operate on). The change only applies after the user confirms a VS Code modal; until then nothing changes. Provide org ids (from buddy_list_orgs) and/or workflow ids. By default the ids are added to the current scope; set replace:true to replace the listed dimension. To work on a different org or workflow, request it here rather than passing a different orgId to other tools.',
	inputSchema: {
		type: 'object',
		properties: {
			orgs: {
				type: 'array',
				items: { type: 'string' },
				description: 'Org ids to put in scope (from buddy_list_orgs).',
			},
			workflows: { type: 'array', items: { type: 'string' }, description: 'Workflow ids to put in scope.' },
			replace: {
				type: 'boolean',
				description: 'Replace the listed dimension instead of adding to it. Omitted dimensions are left as-is.',
			},
		},
	},
};

async function runGetWorkingScope(): Promise<string> {
	const settings = readMcpSettings();
	const scope = currentScope();
	return JSON.stringify(
		{
			orgs: scope.orgs,
			workflows: scope.workflows,
			scopeMode: settings.workingOrgScope,
			alwaysAllowedOrgs: settings.alwaysAllowedOrgs,
		},
		null,
		2,
	);
}

const WORKFLOW_NAME_QUERY =
	'query RewstBuddyScopeWorkflowName($id: ID!) { workflow(where: { id: $id }) { id name orgId } }';

async function resolveWorkflowNames(ids: string[], sessions: Session[]): Promise<NamedWorkflow[]> {
	const results: NamedWorkflow[] = [];
	for (const id of ids) {
		let resolved: NamedWorkflow | null = null;
		for (const session of sessions) {
			try {
				const data = (await rawGraphqlOrThrow(session, WORKFLOW_NAME_QUERY, { id })) as {
					workflow?: { id: string; name: string; orgId?: string } | null;
				};
				if (data.workflow) {
					resolved = data.workflow;
					break;
				}
			} catch {
				// try next session
			}
		}
		if (!resolved) {
			throw new Error(
				`No active session can see workflow ${id}. Check the id — names are shown to the user before scope approval.`,
			);
		}
		results.push(resolved);
	}
	return results;
}

async function runSetWorkingScope(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const replace = input.replace === true;
	const orgIds = toIdArray(input.orgs);
	const workflowIds = toIdArray(input.workflows);
	if (orgIds.length === 0 && workflowIds.length === 0) {
		throw new Error(
			'Provide at least one org id ("orgs") and/or workflow id ("workflows") to set the working scope.',
		);
	}

	const managed = managedOrgs(ctx.sessions);
	const unknown = orgIds.filter(id => !managed.has(id));
	if (unknown.length > 0) {
		throw new Error(
			`No active session manages these orgs: ${unknown.join(', ')}. Call buddy_list_orgs for valid ids.`,
		);
	}

	// Resolve workflow names before showing any approval modal.
	const namedWorkflows = workflowIds.length > 0 ? await resolveWorkflowNames(workflowIds, ctx.sessions) : [];

	const namedOrgs: NamedOrg[] = orgIds.map(id => ({ id, name: managed.get(id) ?? id }));

	// Issue one approval per org (as a group) then one per workflow, sequentially.
	const approvedOrgIds: string[] = [];
	const deniedOrgIds: string[] = [];
	if (namedOrgs.length > 0) {
		const orgRequest: WorkingScopeChangeRequest = { orgs: namedOrgs, workflows: [], replace };
		if (await requestWorkingScopeApproval(orgRequest)) {
			approvedOrgIds.push(...orgIds);
		} else {
			deniedOrgIds.push(...orgIds);
		}
	}

	const approvedWorkflows: NamedWorkflow[] = [];
	const deniedWorkflows: NamedWorkflow[] = [];
	for (const wf of namedWorkflows) {
		const wfRequest: WorkingScopeChangeRequest = { orgs: [], workflows: [wf], replace };
		if (await requestWorkingScopeApproval(wfRequest)) {
			approvedWorkflows.push(wf);
		} else {
			deniedWorkflows.push(wf);
		}
	}

	const approvedWorkflowIds = approvedWorkflows.map(wf => wf.id);
	const deniedWorkflowIds = deniedWorkflows.map(wf => wf.id);

	const nothingApproved = approvedOrgIds.length === 0 && approvedWorkflowIds.length === 0;
	const everythingApproved = deniedOrgIds.length === 0 && deniedWorkflowIds.length === 0;

	if (nothingApproved) {
		return JSON.stringify({ status: 'denied' }, null, 2);
	}

	// Apply only the approved parts.
	WorkingScopeManager.applyChange(
		{
			orgs: approvedOrgIds.length > 0 ? approvedOrgIds : undefined,
			workflows: approvedWorkflowIds.length > 0 ? approvedWorkflowIds : undefined,
			replace,
		},
		approvedWorkflows,
	);

	if (everythingApproved) {
		return JSON.stringify({ status: 'ok', scope: currentScope() }, null, 2);
	}

	return JSON.stringify(
		{
			status: 'partial',
			approved: { orgs: approvedOrgIds, workflows: approvedWorkflowIds },
			denied: { orgs: deniedOrgIds, workflows: deniedWorkflowIds },
			scope: currentScope(),
		},
		null,
		2,
	);
}

export const getWorkingScopeCapability: Capability = readCapability(getWorkingScopeSpec, runGetWorkingScope, {
	requiresOrg: false,
});

// Read access: changing scope is not a Rewst write, so it bypasses the write
// gate (it cannot require an org already in scope) and stays always-available.
export const setWorkingScopeCapability: Capability = readCapability(setWorkingScopeSpec, runSetWorkingScope, {
	requiresOrg: false,
});

export const WORKING_SCOPE_CAPABILITIES: Capability[] = [getWorkingScopeCapability, setWorkingScopeCapability];
