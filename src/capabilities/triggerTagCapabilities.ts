import { z } from 'zod';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability, writeCapability } from './capabilityFactories';
import { ORG_ID_FIELD, json, parseCapabilityInput, requiredStringField, toInputSchema } from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';
import {
	dedupe,
	mergeIdSet,
	requireTriggerState,
	runTriggerUpdate,
	tagIdsOf,
	type IdSetOperation,
	type TriggerState,
} from './triggerUpdate';

/**
 * Read + tag-edit capabilities for Rewst triggers.
 *
 * buddy_get_trigger surfaces the activation-related fields the triggers list view
 * omits (tags, resolved activation orgs, cloneOverrides, autoActivateManagedOrgs,
 * criteria, parameters, …). It is honest that the top-level `activatedForOrgIds`
 * updateTrigger INPUT is not readable — only the resolved `activatedForOrgs` list
 * is — so callers do not assume they can read-then-echo it.
 *
 * buddy_set_trigger_tags edits the trigger's tag set (the `activatedForTagIds`
 * input). The wire semantics are full-replace, so add/remove read the current
 * tags first and send the merged result — an edit never silently drops existing
 * tags. Every write goes through the shared updateTrigger helper (createPatch:true
 * + before/after diff) and per-call VS Code approval, and is hidden unless
 * rewst-buddy.mcp.enableWriteTools.
 */

const NOT_READABLE_NOTE =
	'activatedForOrgs is the resolved activation-org list; the top-level activatedForOrgIds updateTrigger input is not independently readable. cloneOverrides may carry its own activatedForOrgIds, which is distinct from top-level activation and from tags.';

// --- buddy_get_trigger -----------------------------------------------------

const getTriggerSchema = z.object({
	orgId: ORG_ID_FIELD,
	triggerId: requiredStringField('triggerId').describe('Id of the trigger to read.'),
});

const getTriggerSpec: ToolSpecDefinition = {
	name: 'buddy_get_trigger',
	description:
		'Read one Rewst workflow trigger in full, by org and trigger id, surfacing the activation-related fields the triggers list omits: tags, activatedForOrgs (resolved activation orgs), cloneOverrides, autoActivateManagedOrgs, description, criteria, parameters, state, formId, enabled, workflowId, name. Note: the top-level activatedForOrgIds updateTrigger input is not readable; activatedForOrgs is the resolved list.',
	inputSchema: toInputSchema(getTriggerSchema),
};

async function runGetTrigger(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, triggerId } = parseCapabilityInput(getTriggerSchema, input);
	const state = await requireTriggerState(ctx, triggerId, orgId);
	return json({
		id: state.id,
		name: state.name ?? null,
		enabled: state.enabled ?? null,
		orgId: state.orgId ?? orgId,
		workflowId: state.workflowId ?? null,
		formId: state.formId ?? null,
		description: state.description ?? null,
		autoActivateManagedOrgs: state.autoActivateManagedOrgs ?? null,
		criteria: state.criteria ?? null,
		parameters: state.parameters ?? null,
		state: state.state ?? null,
		cloneOverrides: state.cloneOverrides ?? null,
		tags: state.tags,
		tagIds: tagIdsOf(state),
		activatedForOrgs: state.activatedForOrgs,
		notes: NOT_READABLE_NOTE,
	});
}

// --- buddy_set_trigger_tags ------------------------------------------------

const TAG_OPERATIONS = ['add', 'remove', 'replace'] as const;

const TAG_IDS_ERROR = 'Missing required non-empty string array argument "tagIds".';

const setTriggerTagsSchema = z.object({
	orgId: ORG_ID_FIELD,
	triggerId: requiredStringField('triggerId').describe('Id of the trigger whose tags to edit.'),
	operation: z
		.enum(TAG_OPERATIONS, {
			error: `"operation" must be one of ${TAG_OPERATIONS.join(', ')}.`,
		})
		.describe('add appends tags to the current set, remove takes them away, replace sets the tag set exactly.'),
	tagIds: z
		.array(requiredStringField('tagIds'), { error: TAG_IDS_ERROR })
		.min(1, { error: TAG_IDS_ERROR })
		.describe('Tag ids (from buddy_list_tags) to add, remove, or set as the full tag set.'),
});

const setTriggerTagsSpec: ToolSpecDefinition = {
	name: 'buddy_set_trigger_tags',
	description:
		"Edit one Rewst trigger's tags (the activatedForTagIds set), identified by org and trigger id. operation add appends the given tag ids to the current tags, remove takes them away, replace sets the tag set exactly. add and remove read the current tags first and send the merged result, so existing tags are never silently dropped. The edit creates a revertable patch and returns a before/after diff. Requires write tools to be enabled and per-call approval in VS Code.",
	inputSchema: toInputSchema(setTriggerTagsSchema),
};

async function runSetTriggerTags(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, triggerId, operation, tagIds } = parseCapabilityInput(setTriggerTagsSchema, input);
	const orgName = orgDisplayName(ctx);
	// Pre-approval read only verifies org ownership and names the trigger in the
	// approval prompt; the merge is recomputed from a fresh read after approval,
	// so a tag change made while the prompt was open is not overwritten.
	const preview: TriggerState = await requireTriggerState(ctx, triggerId, orgId);
	const name = preview.name ?? '(unnamed)';

	const scope: MutationScope = { scopeId: triggerId, scopeName: name, orgId, orgName };
	const summary = `${operation} tags on trigger "${name}" (${triggerId}) in org "${orgName}" (${orgId})`;
	// alwaysPrompt: approval scopes key on [orgId, resourceId] with no operation
	// component, and replace can clear the whole tag set — an approval granted
	// for a benign add must not be silently reused for it (#177 rationale).
	const runApproved = async () => {
		const before = await requireTriggerState(ctx, triggerId, orgId);
		const currentTagIds = tagIdsOf(before);
		const nextTagIds = mergeIdSet(operation, currentTagIds, dedupe(tagIds));
		const result = await runTriggerUpdate(ctx, {
			triggerId,
			orgId,
			before,
			delta: { activatedForTagIds: nextTagIds },
		});
		return json({
			status: 'updated',
			operation,
			id: triggerId,
			name: result.after.name ?? name,
			tagIds: { before: currentTagIds, after: tagIdsOf(result.after) },
			changed: result.changed,
			notes: NOT_READABLE_NOTE,
		});
	};
	return withMutationApproval(scope, summary, runApproved, { alwaysPrompt: true });
}

export const TRIGGER_TAG_CAPABILITIES: Capability[] = [
	readCapability(getTriggerSpec, runGetTrigger),
	writeCapability(setTriggerTagsSpec, runSetTriggerTags),
];
