import { z } from 'zod';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	optionalStringField,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requireResourceInOrg,
	toInputSchema,
} from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';

/**
 * Tag write capabilities. createTag carries orgId in its input so it is natively
 * org-scoped; update and delete act on a tag by id, and one session can manage
 * many orgs, so each first re-verifies the tag belongs to the requested org
 * (requireTagInOrg) before mutating. Every mutation is approval-gated and hidden
 * unless rewst-buddy.mcp.enableWriteTools.
 */

const CREATE_TAG = `mutation RewstBuddyMcpCreateTag($tag: TagCreateInput!) {
  createTag(tag: $tag) { id name color orgId }
}`;

const UPDATE_TAG = `mutation RewstBuddyMcpUpdateTag($tag: TagUpdateInput!) {
  updateTag(tag: $tag) { id name color orgId }
}`;

const DELETE_TAG = `mutation RewstBuddyMcpDeleteTag($id: ID!) {
  deleteTag(id: $id)
}`;

const TAG_BY_ID = `query RewstBuddyMcpTagById($orgId: ID!, $id: ID!) {
  tags(where: { orgId: $orgId, id: $id }) { id name color description orgId }
}`;

interface TagRow {
	id?: string;
	name?: string;
	color?: string;
	description?: string;
	orgId?: string;
}

/**
 * Fetches a tag by id and fails closed unless it belongs to the requested org.
 * Returns the current fields so an update can preserve those it is not changing.
 */
async function requireTagInOrg(ctx: CapabilityContext, tagId: string, orgId: string): Promise<TagRow> {
	return requireResourceInOrg({
		label: 'Tag',
		id: tagId,
		orgId,
		fetch: async () => {
			const data = await rawGraphqlOrThrow(ctx.session, TAG_BY_ID, { orgId, id: tagId });
			const rows = ((data as { tags?: TagRow[] } | undefined)?.tags ?? []) as TagRow[];
			return rows.find(r => r.id === tagId);
		},
		// The query is already org-filtered, so a returned row is in-org by construction.
		inOrg: () => true,
	});
}

const createTagSchema = z.object({
	orgId: ORG_ID_FIELD,
	name: z
		.string({ error: 'Missing required string argument "name".' })
		.trim()
		.min(1, { error: 'Missing required string argument "name".' })
		.describe('Tag name.'),
	color: optionalStringField().describe('Optional color (hex, e.g. #4287f5).'),
	description: optionalStringField().describe('Optional tag description.'),
});

const createTagSpec: ToolSpecDefinition = {
	name: 'buddy_create_tag',
	description:
		'Create a tag in one Rewst organization. color is an optional hex string (e.g. #4287f5). Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(createTagSchema),
};

async function runCreateTag(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, name, color, description } = parseCapabilityInput(createTagSchema, input);
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: orgId, scopeName: `new tag "${name}"`, orgId, orgName };
	const summary = `Create tag "${name}" in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const tag: Record<string, unknown> = { orgId, name };
		if (color !== undefined) tag.color = color;
		if (description !== undefined) tag.description = description;
		const data = await rawGraphqlOrThrow(ctx.session, CREATE_TAG, { tag });
		const created = (data as { createTag?: TagRow } | undefined)?.createTag;
		if (!created?.id) throw new Error('createTag returned no tag; the mutation may have failed.');
		return JSON.stringify({ status: 'created', id: created.id, name: created.name ?? name }, null, 2);
	});
}

const updateTagSchema = z.object({
	orgId: ORG_ID_FIELD,
	tagId: z
		.string({ error: 'Missing required string argument "tagId".' })
		.trim()
		.min(1, { error: 'Missing required string argument "tagId".' })
		.describe('Id of the tag to update.'),
	name: optionalStringField().describe('Optional new name (defaults to the current name).'),
	color: optionalStringField().describe('Optional new color (hex).'),
	description: optionalStringField().describe('Optional new description.'),
});

const updateTagSpec: ToolSpecDefinition = {
	name: 'buddy_update_tag',
	description:
		'Update one existing tag (name, color, and/or description), identified by org and tag id. The tag must belong to the given org. Fields not supplied keep their current value. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(updateTagSchema),
};

async function runUpdateTag(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const {
		orgId,
		tagId,
		name: nameOverride,
		color: colorOverride,
		description: descriptionOverride,
	} = parseCapabilityInput(updateTagSchema, input);
	const orgName = orgDisplayName(ctx);
	const current = await requireTagInOrg(ctx, tagId, orgId);
	const name = nameOverride ?? current.name ?? '';
	if (!name) throw new Error(`Tag ${tagId} has no name; provide one to update.`);
	const scope: MutationScope = { scopeId: tagId, scopeName: current.name ?? name, orgId, orgName };
	const summary = `Update tag "${current.name ?? name}" (${tagId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const tag: Record<string, unknown> = { id: tagId, orgId, name };
		const color = colorOverride ?? current.color;
		const description = descriptionOverride ?? current.description;
		if (color !== undefined) tag.color = color;
		if (description !== undefined) tag.description = description;
		const data = await rawGraphqlOrThrow(ctx.session, UPDATE_TAG, { tag });
		const updated = (data as { updateTag?: TagRow } | undefined)?.updateTag;
		if (!updated?.id) throw new Error('updateTag returned no tag; the mutation may have failed.');
		return JSON.stringify({ status: 'updated', id: updated.id, name: updated.name ?? name }, null, 2);
	});
}

const deleteTagSchema = z.object({
	orgId: ORG_ID_FIELD,
	tagId: z
		.string({ error: 'Missing required string argument "tagId".' })
		.trim()
		.min(1, { error: 'Missing required string argument "tagId".' })
		.describe('Id of the tag to delete.'),
});

const deleteTagSpec: ToolSpecDefinition = {
	name: 'buddy_delete_tag',
	description:
		'Permanently delete one tag, identified by org and tag id. The tag must belong to the given org. This cannot be undone. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(deleteTagSchema),
};

async function runDeleteTag(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, tagId } = parseCapabilityInput(deleteTagSchema, input);
	const orgName = orgDisplayName(ctx);
	const current = await requireTagInOrg(ctx, tagId, orgId);
	const name = current.name ?? '(unnamed)';
	const scope: MutationScope = { scopeId: tagId, scopeName: name, orgId, orgName };
	const summary = `Delete tag "${name}" (${tagId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const data = await rawGraphqlOrThrow(ctx.session, DELETE_TAG, { id: tagId });
		const deletedId = (data as { deleteTag?: string | null } | undefined)?.deleteTag;
		if (!deletedId) throw new Error('deleteTag returned no id; the mutation may have failed.');
		return JSON.stringify({ status: 'deleted', id: deletedId, name }, null, 2);
	});
}

export const TAG_MUTATE_CAPABILITIES: Capability[] = [
	writeCapability(createTagSpec, runCreateTag),
	writeCapability(updateTagSpec, runUpdateTag),
	writeCapability(deleteTagSpec, runDeleteTag),
];
