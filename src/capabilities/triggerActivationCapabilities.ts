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
import { activatedOrgIdsOf, dedupe, requireTriggerState, runTriggerUpdate, type TriggerState } from './triggerUpdate';

/**
 * Org-activation edit capability for Rewst triggers, sibling to
 * buddy_set_trigger_tags. buddy_set_trigger_activation sets which orgs a trigger
 * is explicitly activated for (the top-level `activatedForOrgIds` input) and/or
 * the trigger's `autoActivateManagedOrgs` setting.
 *
 * Unlike the tag set, the org activation is FULL-REPLACE and not readable back:
 * the top-level `activatedForOrgIds` input is not exposed on the Trigger type,
 * and the readable `activatedForOrgs` is the RESOLVED union (explicit + tag- +
 * auto- + clone-activated orgs), not the explicit set. Echoing `activatedForOrgs`
 * back as `activatedForOrgIds` would silently pin dynamically-activated orgs as
 * hard explicit ones — the #181 bug class. So this tool cannot add/remove against
 * the current set; it overwrites with exactly the orgIds passed. The caller
 * supplies the complete intended explicit set (empty = deactivate all).
 *
 * Only the changed fields are sent, so `cloneOverrides` (whose own
 * `activatedForOrgIds` is a distinct per-clone override) survives the merge
 * update untouched — the tool never conflates the two. Tag-based activation is
 * out of scope here; that is buddy_set_trigger_tags. Every write goes through the
 * shared updateTrigger helper (createPatch:true + before/after diff) and per-call
 * VS Code approval, and is hidden unless rewst-buddy.mcp.enableWriteTools.
 */

const ACTIVATION_NOTE =
	'Org activation is set through the top-level activatedForOrgIds input, which is full-replace and is NOT independently readable, so this tool overwrites the explicit activation with exactly the orgIds passed — it cannot add to or remove from the current set. cloneOverrides.activatedForOrgIds is a distinct per-clone override and is left untouched. The before/after resolvedActivatedForOrgs values are the resolved activatedForOrgs lists, which can include orgs activated by tag or auto-activate and are not the explicit input set; a save can also re-propagate per-org activation instances, so check the returned diff and re-sync in the Rewst UI if activation shifts unexpectedly.';

const setTriggerActivationSchema = z.object({
	orgId: ORG_ID_FIELD,
	triggerId: requiredStringField('triggerId').describe('Id of the trigger whose activation to edit.'),
	orgIds: z
		.array(requiredStringField('orgIds'), { error: 'orgIds must be an array of org id strings.' })
		.optional()
		.describe(
			'The exact, complete set of org ids to activate the trigger for (top-level activatedForOrgIds, full-replace). This overwrites the current explicit activation, so pass the whole intended set; an empty list deactivates the trigger for all orgs. The current explicit activatedForOrgIds is not readable, so this tool cannot add/remove against it — use buddy_get_trigger to see the resolved activatedForOrgs for context (it may include orgs activated by tag or auto-activate, which are not the explicit set).',
		),
	autoActivateManagedOrgs: optionalBooleanField('autoActivateManagedOrgs').describe(
		'When provided, sets whether the trigger auto-activates for every managed org.',
	),
});

const setTriggerActivationSpec: ToolSpecDefinition = {
	name: 'buddy_set_trigger_activation',
	description:
		"Set which orgs a Rewst trigger is explicitly activated for (the top-level activatedForOrgIds set) and/or its autoActivateManagedOrgs setting, identified by org and trigger id. Org activation is full-replace and not readable back, so this tool overwrites the explicit activation with exactly the orgIds passed (pass the complete intended set; an empty list deactivates all orgs) — it does not add to or remove from the current set. cloneOverrides is left untouched. This tool does not edit tags — use buddy_set_trigger_tags for that. The edit creates a revertable patch and returns a before/after diff. Requires write tools to be enabled and per-call approval in VS Code.",
	inputSchema: toInputSchema(setTriggerActivationSchema),
};

async function runSetTriggerActivation(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, triggerId, orgIds, autoActivateManagedOrgs } = parseCapabilityInput(
		setTriggerActivationSchema,
		input,
	);

	// At least one field must actually change. `false` is a valid, meaningful
	// autoActivateManagedOrgs value, so this must test `!== undefined`, not truthiness.
	if (orgIds === undefined && autoActivateManagedOrgs === undefined) {
		throw new Error('Provide an org activation set (orgIds) and/or autoActivateManagedOrgs.');
	}

	const orgName = orgDisplayName(ctx);
	// Pre-approval read only verifies org ownership and names the trigger in the
	// approval prompt.
	const preview: TriggerState = await requireTriggerState(ctx, triggerId, orgId);
	const name = preview.name ?? '(unnamed)';

	const scope: MutationScope = { scopeId: triggerId, scopeName: name, orgId, orgName };
	const parts: string[] = [];
	if (orgIds !== undefined) parts.push(`set activation to ${dedupe(orgIds).length} org(s)`);
	if (autoActivateManagedOrgs !== undefined) parts.push(`set autoActivateManagedOrgs=${autoActivateManagedOrgs}`);
	const summary = `${parts.join(' and ')} on trigger "${name}" (${triggerId}) in org "${orgName}" (${orgId})`;

	// alwaysPrompt: approval scopes key on [orgId, resourceId] with no operation
	// component, and an activation replace can clear all activation — an approval
	// granted for an earlier edit must not be silently reused (#177 rationale).
	const runApproved = async () => {
		const before = await requireTriggerState(ctx, triggerId, orgId);
		const delta: Record<string, unknown> = {};
		if (orgIds !== undefined) delta.activatedForOrgIds = dedupe(orgIds);
		if (autoActivateManagedOrgs !== undefined) delta.autoActivateManagedOrgs = autoActivateManagedOrgs;
		const result = await runTriggerUpdate(ctx, { triggerId, orgId, before, delta });
		return json({
			status: 'updated',
			id: triggerId,
			name: result.after.name ?? name,
			// The resolved activatedForOrgs lists, for context only — these are not
			// the explicit activatedForOrgIds input the edit sets.
			resolvedActivatedForOrgs: { before: activatedOrgIdsOf(before), after: activatedOrgIdsOf(result.after) },
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
