import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import { ORG_ID_PROP, asString, rawGraphqlOrThrow, requireResourceInOrg, requireString } from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';
import { CRATE_REUSE_STEERING } from '@workflow';

/**
 * Workflow create/delete capabilities. buddy_create_workflow makes an empty workflow
 * (edit it afterwards with buddy_workflow_edit) and carries orgId in its input.
 * buddy_delete_workflow acts by id, and one session can manage many orgs, so it first
 * re-verifies the workflow belongs to the requested org (requireWorkflowInOrg)
 * before deleting. Both are approval-gated and hidden unless
 * rewst-buddy.mcp.enableWriteTools. Deleting a workflow also removes its triggers,
 * tasks, and execution history, so the approval summary calls this out.
 */

const CREATE_WORKFLOW = `mutation RewstBuddyMcpCreateWorkflow($workflow: WorkflowInput!) {
  createWorkflow(workflow: $workflow) { id name orgId }
}`;

const DELETE_WORKFLOW = `mutation RewstBuddyMcpDeleteWorkflow($id: ID!) {
  deleteWorkflow(id: $id)
}`;

const WORKFLOW_OWNER = `query RewstBuddyMcpWorkflowOwner($id: ID!) {
  workflow(where: { id: $id }) { id name orgId }
}`;

interface WorkflowRow {
	id?: string;
	name?: string;
	orgId?: string;
}

const WORKFLOW_DESCRIPTION_MAX_LENGTH = 255;

/**
 * Fetches a workflow by id and fails closed unless it belongs to the requested
 * org. Returns the workflow name for the approval scope.
 */
async function requireWorkflowInOrg(ctx: CapabilityContext, workflowId: string, orgId: string): Promise<WorkflowRow> {
	return requireResourceInOrg({
		label: 'Workflow',
		id: workflowId,
		orgId,
		fetch: async () => {
			const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_OWNER, { id: workflowId });
			return (data as { workflow?: WorkflowRow } | undefined)?.workflow;
		},
	});
}

const createWorkflowSpec: ToolSpec = {
	name: 'buddy_create_workflow',
	args: '{"orgId": string, "name": string, "description"?: string}',
	description: `Create a new, empty Rewst workflow in one organization, returning its id and name. Description is optional and limited to ${WORKFLOW_DESCRIPTION_MAX_LENGTH} characters. Add tasks and transitions afterwards with buddy_workflow_edit. Requires write tools to be enabled and per-call approval in VS Code. ${CRATE_REUSE_STEERING}`,
	// NOTE: CRATE_REUSE_STEERING is embedded verbatim above — do not paraphrase it here.
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			name: { type: 'string', description: 'Name for the new workflow.' },
			description: {
				type: 'string',
				maxLength: WORKFLOW_DESCRIPTION_MAX_LENGTH,
				description: `Optional workflow description, up to ${WORKFLOW_DESCRIPTION_MAX_LENGTH} characters.`,
			},
		},
		required: ['orgId', 'name'],
	},
};

async function runCreateWorkflow(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const name = requireString(input, 'name');
	const description = asString(input, 'description');
	if (description !== undefined && description.length > WORKFLOW_DESCRIPTION_MAX_LENGTH) {
		throw new Error(`Workflow description must be ${WORKFLOW_DESCRIPTION_MAX_LENGTH} characters or fewer.`);
	}
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: orgId, scopeName: `new workflow "${name}"`, orgId, orgName };
	const summary = `Create workflow "${name}" in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const workflow: Record<string, unknown> = { orgId, name };
		if (description !== undefined) workflow.description = description;
		const data = await rawGraphqlOrThrow(ctx.session, CREATE_WORKFLOW, { workflow });
		const created = (data as { createWorkflow?: WorkflowRow } | undefined)?.createWorkflow;
		if (!created?.id) throw new Error('createWorkflow returned no workflow; the mutation may have failed.');
		return JSON.stringify({ status: 'created', id: created.id, name: created.name ?? name }, null, 2);
	});
}

const deleteWorkflowSpec: ToolSpec = {
	name: 'buddy_delete_workflow',
	args: '{"orgId": string, "workflowId": string}',
	description:
		'Permanently delete one Rewst workflow, identified by org and workflow id. The workflow must belong to the given org. This also removes its triggers, tasks, and execution history and cannot be undone. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			workflowId: { type: 'string', description: 'Id of the workflow to delete.' },
		},
		required: ['orgId', 'workflowId'],
	},
};

async function runDeleteWorkflow(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const workflowId = requireString(input, 'workflowId');
	const orgName = orgDisplayName(ctx);
	const current = await requireWorkflowInOrg(ctx, workflowId, orgId);
	const name = current.name ?? '(unnamed)';
	const scope: MutationScope = { scopeId: workflowId, scopeName: name, orgId, orgName };
	const summary = `Delete workflow "${name}" (${workflowId}) and its triggers, tasks, and history in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const data = await rawGraphqlOrThrow(ctx.session, DELETE_WORKFLOW, { id: workflowId });
		const deletedId = (data as { deleteWorkflow?: string | null } | undefined)?.deleteWorkflow;
		if (!deletedId) throw new Error('deleteWorkflow returned no id; the mutation may have failed.');
		return JSON.stringify({ status: 'deleted', id: deletedId, name }, null, 2);
	});
}

export const WORKFLOW_CRUD_CAPABILITIES: Capability[] = [
	writeCapability(createWorkflowSpec, runCreateWorkflow),
	writeCapability(deleteWorkflowSpec, runDeleteWorkflow),
];
