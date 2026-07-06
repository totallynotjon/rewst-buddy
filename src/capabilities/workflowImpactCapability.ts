import { z } from 'zod';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import {
	optionalStringField,
	ORG_ID_FIELD,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requiredStringField,
	requireResourceInOrg,
	toInputSchema,
} from './inputHelpers';

/**
 * buddy_workflow_impact — two-mode impact analysis:
 *   workflowId mode: lists every workflow that calls this one as a sub-workflow
 *   actions mode:    lists workflows affected by breaking changes to pack actions
 */

const WORKFLOW_ORG_QUERY = `
query RewstBuddyMcpWorkflowImpactOrg($id: ID!) {
  workflow(where: { id: $id }) {
    id
    name
    orgId
  }
}
`.trim();

const WORKFLOW_CALLERS_QUERY = `
query RewstBuddyMcpWorkflowImpactCallers($id: ID!) {
  workflow(where: { id: $id }) {
    parentWorkflows {
      name
      workflowId
      workflow {
        id
        name
        orgId
      }
    }
  }
}
`.trim();

const ACTION_IMPACT_QUERY = `
query RewstBuddyMcpActionImpact($orgId: ID!, $actions: [BreakingChangeActionInput!]!) {
  workflowsAffectedByBreakingChanges(orgId: $orgId, actions: $actions) {
    workflowId
    workflowName
    affectedActionNames
  }
}
`.trim();

interface WorkflowRow {
	id?: string | null;
	name?: string | null;
	orgId?: string | null;
	parentWorkflows?: ParentWorkflowTask[] | null;
}

interface ParentWorkflowTask {
	name?: string | null;
	workflowId?: string | null;
	workflow?: {
		id?: string | null;
		name?: string | null;
		orgId?: string | null;
	} | null;
}

interface AffectedWorkflow {
	workflowId?: string | null;
	workflowName?: string | null;
	affectedActionNames?: string[] | null;
}

const workflowImpactInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	workflowId: optionalStringField().describe(
		'The workflow whose callers to list — every workflow that calls it as a sub-workflow.',
	),
	actions: z
		.array(
			z.object({
				packRef: requiredStringField('packRef').describe('Pack reference string.'),
				actionRefs: z
					.array(z.string().trim().min(1))
					.min(1, { error: 'actions entries must include at least one actionRefs value.' })
					.describe('Action reference strings within the pack.'),
			}),
		)
		.min(1, { error: 'actions must include at least one entry.' })
		.optional()
		.describe('Pack actions to check for breaking-change impact instead of a workflowId.'),
});

type WorkflowImpactInput = z.infer<typeof workflowImpactInputSchema>;

async function runWorkflowIdMode(workflowId: string, orgId: string, ctx: CapabilityContext): Promise<string> {
	const workflow = await requireResourceInOrg<WorkflowRow>({
		label: 'Workflow',
		id: workflowId,
		orgId,
		fetch: async () => {
			const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_ORG_QUERY, { id: workflowId });
			return (data as { workflow?: WorkflowRow | null } | undefined)?.workflow ?? undefined;
		},
	});

	const name = workflow.name ?? '(unnamed)';
	const callerData = await rawGraphqlOrThrow(ctx.session, WORKFLOW_CALLERS_QUERY, { id: workflowId });
	const tasks =
		(callerData as { workflow?: Pick<WorkflowRow, 'parentWorkflows'> | null } | undefined)?.workflow
			?.parentWorkflows ?? [];

	if (tasks.length === 0) {
		return `No workflows call "${name}" (${workflowId}) as a sub-workflow. No callers break if its inputs or output change.`;
	}

	// Deduplicate by calling workflow id, collecting task names per caller
	const callerMap = new Map<string, { callerName: string; callerId: string; taskNames: string[] }>();
	for (const task of tasks) {
		const callerId = task.workflow?.id ?? task.workflowId ?? 'unknown';
		const callerName = task.workflow?.name ?? '(unnamed)';
		const taskName = task.name ?? '(unnamed task)';
		if (!callerMap.has(callerId)) {
			callerMap.set(callerId, { callerName, callerId, taskNames: [] });
		}
		callerMap.get(callerId)!.taskNames.push(taskName);
	}

	const callerCount = callerMap.size;
	const lines: string[] = [
		`${callerCount} workflow(s) call "${name}" (${workflowId}) as a sub-workflow — changing its inputs (set_inputs) or output (set_output) affects all of them:`,
	];
	for (const { callerName, callerId, taskNames } of callerMap.values()) {
		lines.push(`- ${callerName} (${callerId}) — via task(s): ${taskNames.join(', ')}`);
	}
	return lines.join('\n');
}

async function runActionsMode(
	actions: NonNullable<WorkflowImpactInput['actions']>,
	orgId: string,
	ctx: CapabilityContext,
): Promise<string> {
	const data = await rawGraphqlOrThrow(ctx.session, ACTION_IMPACT_QUERY, { orgId, actions });
	const affected =
		(data as { workflowsAffectedByBreakingChanges?: AffectedWorkflow[] | null } | undefined)
			?.workflowsAffectedByBreakingChanges ?? [];

	if (affected.length === 0) {
		return `No workflows in org ${orgId} are affected by breaking changes to the given pack actions.`;
	}

	const lines: string[] = [`${affected.length} workflow(s) affected by breaking changes to the given pack actions:`];
	for (const wf of affected) {
		const wfName = wf.workflowName ?? '(unnamed)';
		const wfId = wf.workflowId ?? '(unknown id)';
		const actionNames = (wf.affectedActionNames ?? []).join(', ') || '(none listed)';
		lines.push(`- ${wfName} (${wfId}) — affected action(s): ${actionNames}`);
	}
	return lines.join('\n');
}

async function run(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, workflowId, actions } = parseCapabilityInput(workflowImpactInputSchema, input);

	// Exactly-one mode check — must happen BEFORE any GraphQL call
	if ((workflowId === undefined) === (actions === undefined)) {
		throw new Error('Pass exactly one of "workflowId" or "actions".');
	}

	if (workflowId !== undefined) {
		return runWorkflowIdMode(workflowId, orgId, ctx);
	}
	return runActionsMode(actions!, orgId, ctx);
}

const spec: ToolSpecDefinition = {
	name: 'buddy_workflow_impact',
	description:
		'List the workflows that would break when a contract changes. Pass workflowId to list every workflow that calls that workflow as a sub-workflow — use this before buddy_workflow_edit set_inputs or set_output on a workflow other workflows call. Or pass actions ([{packRef, actionRefs}]) to list the workflows affected by breaking changes to those pack actions. Returns names, ids, and the calling task or affected action names.',
	inputSchema: toInputSchema(workflowImpactInputSchema),
};

export const workflowImpactCapability: Capability = readCapability(spec, run);
