import { z } from 'zod';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	json,
	optionalBooleanField,
	parseCapabilityInput,
	requiredStringField,
	toInputSchema,
} from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';
import {
	activatedOrgIdsOf,
	dedupe,
	mergeIdSet,
	requireTriggerState,
	runTriggerUpdate,
	type TriggerState,
} from './triggerUpdate';

/**
 * Org-activation edit capability for Rewst triggers, sibling to
 * buddy_set_trigger_tags. buddy_set_trigger_activation edits which orgs a trigger
 * is activated for (the top-level `activatedForOrgIds` input) and/or the
 * trigger's `autoActivateManagedOrgs` setting.
 *
 * The wire semantics of `activatedForOrgIds` are full-replace, and — unlike tags
 * — the input is not itself readable, so add/remove read the resolved
 * `activatedForOrgs` list and send the merged id set; an edit never silently
 * drops an activation the caller did not name. Only the changed fields are sent,
 * so `cloneOverrides` (whose own `activatedForOrgIds` is a distinct, per-clone
 * override) survives the merge update untouched — the tool never conflates the
 * two. Tag-based activation is out of scope here; that is buddy_set_trigger_tags.
 * Every write goes through the shared updateTrigger helper (createPatch:true +
 * before/after diff) and per-call VS Code approval, and is hidden unless
 * rewst-buddy.mcp.enableWriteTools.
 */

const ACTIVATION_OPERATIONS = ['add', 'remove', 'replace'] as const;

const ORG_IDS_ERROR = 'Missing required non-empty string array argument "orgIds".';

const ACTIVATION_NOTE =
	'Org activation is set through the top-level activatedForOrgIds input (full-replace); add/remove merge against the resolved activatedForOrgs first so untouched orgs are preserved. cloneOverrides.activatedForOrgIds is a distinct per-clone override and is left untouched by this tool. A trigger save can re-propagate per-org activation instances — check the returned diff and re-sync in the Rewst UI if activation shifts.';

const setTriggerActivationSchema = z.object({
	orgId: ORG_ID_FIELD,
	triggerId: requiredStringField('triggerId').describe('Id of the trigger whose activation to edit.'),
	operation: z
		.enum(ACTIVATION_OPERATIONS, {
			error: `"operation" must be one of ${ACTIVATION_OPERATIONS.join(', ')}.`,
		})
		.optional()
		.describe(
			'How to change the org activation set: add appends orgs, remove takes them away, replace sets it exactly. Required when orgIds is given.',
		),
	orgIds: z
		.array(requiredStringField('orgIds'))
		.optional()
		.describe(
			'Org ids to activate or deactivate the trigger for (the top-level activatedForOrgIds set, from buddy_list_orgs). Required when operation is given; replace with an empty list deactivates the trigger for all orgs.',
		),
	autoActivateManagedOrgs: optionalBooleanField('autoActivateManagedOrgs').describe(
		'When provided, sets whether the trigger auto-activates for every managed org.',
	),
});

const setTriggerActivationSpec: ToolSpecDefinition = {
	name: 'buddy_set_trigger_activation',
	description:
		"Edit which orgs a Rewst trigger is activated for (the top-level activatedForOrgIds set) and/or its autoActivateManagedOrgs setting, identified by org and trigger id. operation add appends the given org ids to the current activation, remove takes them away, replace sets it exactly (replace with an empty orgIds deactivates all orgs); operation and orgIds are given together. add and remove read the trigger's resolved activatedForOrgs first and send the merged result, so existing activations are never silently dropped. cloneOverrides is left untouched. This tool does not edit tags — use buddy_set_trigger_tags for that. The edit creates a revertable patch and returns a before/after diff. Requires write tools to be enabled and per-call approval in VS Code.",
	inputSchema: toInputSchema(setTriggerActivationSchema),
};

async function runSetTriggerActivation(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, triggerId, operation, orgIds, autoActivateManagedOrgs } = parseCapabilityInput(
		setTriggerActivationSchema,
		input,
	);

	// Cross-field rules (the advertised JSON schema cannot express "at least one
	// of" / "these two together"), validated on the parsed, typed values.
	const editsOrgs = operation !== undefined || orgIds !== undefined;
	if ((operation !== undefined) !== (orgIds !== undefined)) {
		throw new Error('operation and orgIds must be provided together.');
	}
	if (operation !== undefined && operation !== 'replace' && (orgIds?.length ?? 0) === 0) {
		throw new Error(ORG_IDS_ERROR);
	}
	if (!editsOrgs && autoActivateManagedOrgs === undefined) {
		throw new Error('Provide an org activation change (operation + orgIds) and/or autoActivateManagedOrgs.');
	}

	const orgName = orgDisplayName(ctx);
	// Pre-approval read only verifies org ownership and names the trigger in the
	// approval prompt; the org merge is recomputed from a fresh read after
	// approval, so an activation change made while the prompt was open is not
	// overwritten.
	const preview: TriggerState = await requireTriggerState(ctx, triggerId, orgId);
	const name = preview.name ?? '(unnamed)';

	const scope: MutationScope = { scopeId: triggerId, scopeName: name, orgId, orgName };
	const parts: string[] = [];
	if (operation) parts.push(`${operation} ${orgIds?.length ?? 0} activation org(s)`);
	if (autoActivateManagedOrgs !== undefined) parts.push(`set autoActivateManagedOrgs=${autoActivateManagedOrgs}`);
	const summary = `${parts.join(' and ')} on trigger "${name}" (${triggerId}) in org "${orgName}" (${orgId})`;

	// alwaysPrompt: approval scopes key on [orgId, resourceId] with no operation
	// component, and replace can clear all activation — an approval granted for a
	// benign add must not be silently reused for it (#177 rationale).
	const runApproved = async () => {
		const before = await requireTriggerState(ctx, triggerId, orgId);
		const delta: Record<string, unknown> = {};
		if (operation) {
			const currentOrgIds = activatedOrgIdsOf(before);
			delta.activatedForOrgIds = mergeIdSet(operation, currentOrgIds, dedupe(orgIds ?? []));
		}
		if (autoActivateManagedOrgs !== undefined) {
			delta.autoActivateManagedOrgs = autoActivateManagedOrgs;
		}
		const result = await runTriggerUpdate(ctx, { triggerId, orgId, before, delta });
		return json({
			status: 'updated',
			operation: operation ?? null,
			id: triggerId,
			name: result.after.name ?? name,
			activatedForOrgIds: { before: activatedOrgIdsOf(before), after: activatedOrgIdsOf(result.after) },
			autoActivateManagedOrgs: {
				before: before.autoActivateManagedOrgs ?? null,
				after: result.after.autoActivateManagedOrgs ?? null,
			},
			changed: result.changed,
			notes: ACTIVATION_NOTE,
		});
	};
	return withMutationApproval(scope, summary, runApproved, { alwaysPrompt: true });
}

export const TRIGGER_ACTIVATION_CAPABILITIES: Capability[] = [
	writeCapability(setTriggerActivationSpec, runSetTriggerActivation),
];
