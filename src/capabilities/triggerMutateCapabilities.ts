import { z } from 'zod';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requireResourceInOrg,
	toInputSchema,
} from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';

/**
 * Trigger write capabilities. buddy_set_trigger_enabled toggles a workflow trigger on
 * or off via updateTrigger. It acts on a trigger by id, and one session can
 * manage many orgs, so it first re-verifies the trigger belongs to the requested
 * org (requireTriggerInOrg) before mutating. Approval-gated and hidden unless
 * rewst-buddy.mcp.enableWriteTools.
 */

const SET_TRIGGER_ENABLED = `mutation RewstBuddyMcpSetTriggerEnabled($trigger: TriggerUpdateInput!) {
  updateTrigger(trigger: $trigger) { id name enabled orgId }
}`;

const TRIGGER_BY_ID = `query RewstBuddyMcpTriggerById($orgId: ID!, $id: ID!) {
  triggers(where: { orgId: $orgId, id: $id }) { id name enabled orgId }
}`;

interface TriggerRow {
	id?: string;
	name?: string;
	enabled?: boolean;
	orgId?: string;
}

/**
 * Fetches a trigger by id and fails closed unless it belongs to the requested
 * org. Returns the current name for the approval scope.
 */
async function requireTriggerInOrg(ctx: CapabilityContext, triggerId: string, orgId: string): Promise<TriggerRow> {
	return requireResourceInOrg({
		label: 'Trigger',
		id: triggerId,
		orgId,
		fetch: async () => {
			const data = await rawGraphqlOrThrow(ctx.session, TRIGGER_BY_ID, { orgId, id: triggerId });
			const rows = ((data as { triggers?: TriggerRow[] } | undefined)?.triggers ?? []) as TriggerRow[];
			return rows.find(r => r.id === triggerId);
		},
		// The query is already org-filtered, so a returned row is in-org by construction.
		inOrg: () => true,
	});
}

const setTriggerEnabledSchema = z.object({
	orgId: ORG_ID_FIELD,
	triggerId: z
		.string({ error: 'Missing required string argument "triggerId".' })
		.trim()
		.min(1, { error: 'Missing required string argument "triggerId".' })
		.describe('Id of the trigger to enable or disable.'),
	enabled: z
		.boolean({ error: 'Missing required boolean argument "enabled".' })
		.describe('true to enable the trigger, false to disable it.'),
});

const setTriggerEnabledSpec: ToolSpecDefinition = {
	name: 'buddy_set_trigger_enabled',
	description:
		'Enable or disable one Rewst workflow trigger, identified by org and trigger id. The trigger must belong to the given org. Pass enabled=true to turn it on, false to turn it off. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(setTriggerEnabledSchema),
};

async function runSetTriggerEnabled(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, triggerId, enabled } = parseCapabilityInput(setTriggerEnabledSchema, input);
	const orgName = orgDisplayName(ctx);
	const current = await requireTriggerInOrg(ctx, triggerId, orgId);
	const name = current.name ?? '(unnamed)';
	const verb = enabled ? 'Enable' : 'Disable';
	const scope: MutationScope = { scopeId: triggerId, scopeName: name, orgId, orgName };
	const summary = `${verb} trigger "${name}" (${triggerId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const data = await rawGraphqlOrThrow(ctx.session, SET_TRIGGER_ENABLED, {
			trigger: { id: triggerId, enabled },
		});
		const updated = (data as { updateTrigger?: TriggerRow } | undefined)?.updateTrigger;
		if (!updated?.id) throw new Error('updateTrigger returned no trigger; the mutation may have failed.');
		return JSON.stringify(
			{ status: updated.enabled ? 'enabled' : 'disabled', id: updated.id, name: updated.name ?? name },
			null,
			2,
		);
	});
}

export const TRIGGER_MUTATE_CAPABILITIES: Capability[] = [writeCapability(setTriggerEnabledSpec, runSetTriggerEnabled)];
