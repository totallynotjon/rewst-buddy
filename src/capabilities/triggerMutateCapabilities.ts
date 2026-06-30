import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { ORG_ID_PROP, requireString } from './inputHelpers';
import { orgDisplayName, throwOnGraphqlErrors, withMutationApproval } from './mutationApproval';

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

/** Reads a required boolean argument; non-booleans are an error, not coerced. */
function requireBoolean(input: Record<string, unknown>, key: string): boolean {
	const value = input[key];
	if (typeof value !== 'boolean') throw new Error(`Missing required boolean argument "${key}".`);
	return value;
}

/**
 * Fetches a trigger by id and fails closed unless it belongs to the requested
 * org. Returns the current name for the approval scope.
 */
async function requireTriggerInOrg(ctx: CapabilityContext, triggerId: string, orgId: string): Promise<TriggerRow> {
	const { data, errors } = await ctx.session.rawGraphql(TRIGGER_BY_ID, { orgId, id: triggerId });
	throwOnGraphqlErrors(errors);
	const rows = ((data as { triggers?: TriggerRow[] } | undefined)?.triggers ?? []) as TriggerRow[];
	const row = rows.find(r => r.id === triggerId);
	if (!row) throw new Error(`Trigger ${triggerId} is not in org ${orgId}.`);
	return row;
}

const setTriggerEnabledSpec: ToolSpec = {
	name: 'buddy_set_trigger_enabled',
	args: '{"orgId": string, "triggerId": string, "enabled": boolean}',
	description:
		'Enable or disable one Rewst workflow trigger, identified by org and trigger id. The trigger must belong to the given org. Pass enabled=true to turn it on, false to turn it off. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			triggerId: { type: 'string', description: 'Id of the trigger to enable or disable.' },
			enabled: { type: 'boolean', description: 'true to enable the trigger, false to disable it.' },
		},
		required: ['orgId', 'triggerId', 'enabled'],
	},
};

async function runSetTriggerEnabled(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const triggerId = requireString(input, 'triggerId');
	const enabled = requireBoolean(input, 'enabled');
	const orgName = orgDisplayName(ctx);
	const current = await requireTriggerInOrg(ctx, triggerId, orgId);
	const name = current.name ?? '(unnamed)';
	const verb = enabled ? 'Enable' : 'Disable';
	const scope: MutationScope = { scopeId: triggerId, scopeName: name, orgId, orgName };
	const summary = `${verb} trigger "${name}" (${triggerId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const { data, errors } = await ctx.session.rawGraphql(SET_TRIGGER_ENABLED, {
			trigger: { id: triggerId, enabled },
		});
		throwOnGraphqlErrors(errors);
		const updated = (data as { updateTrigger?: TriggerRow } | undefined)?.updateTrigger;
		if (!updated?.id) throw new Error('updateTrigger returned no trigger; the mutation may have failed.');
		return JSON.stringify(
			{ status: updated.enabled ? 'enabled' : 'disabled', id: updated.id, name: updated.name ?? name },
			null,
			2,
		);
	});
}

export const TRIGGER_MUTATE_CAPABILITIES: Capability[] = [
	{ spec: setTriggerEnabledSpec, access: 'write', chat: false, mcp: true, run: runSetTriggerEnabled },
];
