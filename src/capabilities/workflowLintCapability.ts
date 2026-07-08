import { z } from 'zod';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import { WORKFLOW_GET_QUERY } from '../workflow/graphMutations';
import { formatLintReport, lintWorkflow } from '../workflow/lint';
import type { RawWorkflow } from '../workflow/types';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requiredStringField,
	toInputSchema,
} from './inputHelpers';

const inputSchema = z.object({
	orgId: ORG_ID_FIELD,
	workflowId: requiredStringField('workflowId').describe('The workflow to audit.'),
});

const spec: ToolSpecDefinition = {
	name: 'buddy_workflow_lint',
	description:
		'Run a read-only structural audit of one Rewst workflow and return its issues without changing it: ' +
		'tasks unreachable from the entry, transitions whose {{ SUCCEEDED }}/default path is listed before a custom ' +
		'condition (which shadows it under FOLLOW_FIRST), tasks with transitions but no success/default path, action ' +
		'tasks lacking both retry and timeout, tasks with mock input still enabled, and a size heuristic that recommends ' +
		'sub-workflow extraction for large workflows. Use this when asked to review or check a workflow.',
	inputSchema: toInputSchema(inputSchema),
};

async function run(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, workflowId } = parseCapabilityInput(inputSchema, input);

	const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_GET_QUERY, { where: { id: workflowId, orgId } });
	const workflow = (data as { workflow?: RawWorkflow | null } | undefined)?.workflow ?? null;

	if (!workflow) {
		throw new Error(`Workflow ${workflowId} not found in org ${orgId}.`);
	}

	const findings = lintWorkflow(workflow);
	return formatLintReport(workflow, findings);
}

export const workflowLintCapability: Capability = readCapability(spec, run);
