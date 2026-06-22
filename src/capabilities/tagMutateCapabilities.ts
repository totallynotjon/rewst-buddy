import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { ORG_ID_PROP, asString, requireString } from './inputHelpers';
import { orgDisplayName, throwOnGraphqlErrors, withMutationApproval } from './mutationApproval';

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
	const { data, errors } = await ctx.session.rawGraphql(TAG_BY_ID, { orgId, id: tagId });
	throwOnGraphqlErrors(errors);
	const rows = ((data as { tags?: TagRow[] } | undefined)?.tags ?? []) as TagRow[];
	const row = rows.find(r => r.id === tagId);
	if (!row) throw new Error(`Tag ${tagId} is not in org ${orgId}.`);
	return row;
}

const createTagSpec: ToolSpec = {
	name: 'create_tag',
	args: '{"orgId": string, "name": string, "color"?: string, "description"?: string}',
	description:
		'Create a tag in one Rewst organization. color is an optional hex string (e.g. #4287f5). Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			name: { type: 'string', description: 'Tag name.' },
			color: { type: 'string', description: 'Optional color (hex, e.g. #4287f5).' },
			description: { type: 'string', description: 'Optional tag description.' },
		},
		required: ['orgId', 'name'],
	},
};

async function runCreateTag(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const name = requireString(input, 'name');
	const color = asString(input, 'color');
	const description = asString(input, 'description');
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: orgId, scopeName: `new tag "${name}"`, orgId, orgName };
	const summary = `Create tag "${name}" in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const tag: Record<string, unknown> = { orgId, name };
		if (color !== undefined) tag.color = color;
		if (description !== undefined) tag.description = description;
		const { data, errors } = await ctx.session.rawGraphql(CREATE_TAG, { tag });
		throwOnGraphqlErrors(errors);
		const created = (data as { createTag?: TagRow } | undefined)?.createTag;
		if (!created?.id) throw new Error('createTag returned no tag; the mutation may have failed.');
		return JSON.stringify({ status: 'created', id: created.id, name: created.name ?? name }, null, 2);
	});
}

const updateTagSpec: ToolSpec = {
	name: 'update_tag',
	args: '{"orgId": string, "tagId": string, "name"?: string, "color"?: string, "description"?: string}',
	description:
		'Update one existing tag (name, color, and/or description), identified by org and tag id. The tag must belong to the given org. Fields not supplied keep their current value. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			tagId: { type: 'string', description: 'Id of the tag to update.' },
			name: { type: 'string', description: 'Optional new name (defaults to the current name).' },
			color: { type: 'string', description: 'Optional new color (hex).' },
			description: { type: 'string', description: 'Optional new description.' },
		},
		required: ['orgId', 'tagId'],
	},
};

async function runUpdateTag(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const tagId = requireString(input, 'tagId');
	const nameOverride = asString(input, 'name');
	const colorOverride = asString(input, 'color');
	const descriptionOverride = asString(input, 'description');
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
		const { data, errors } = await ctx.session.rawGraphql(UPDATE_TAG, { tag });
		throwOnGraphqlErrors(errors);
		const updated = (data as { updateTag?: TagRow } | undefined)?.updateTag;
		if (!updated?.id) throw new Error('updateTag returned no tag; the mutation may have failed.');
		return JSON.stringify({ status: 'updated', id: updated.id, name: updated.name ?? name }, null, 2);
	});
}

const deleteTagSpec: ToolSpec = {
	name: 'delete_tag',
	args: '{"orgId": string, "tagId": string}',
	description:
		'Permanently delete one tag, identified by org and tag id. The tag must belong to the given org. This cannot be undone. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			tagId: { type: 'string', description: 'Id of the tag to delete.' },
		},
		required: ['orgId', 'tagId'],
	},
};

async function runDeleteTag(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const tagId = requireString(input, 'tagId');
	const orgName = orgDisplayName(ctx);
	const current = await requireTagInOrg(ctx, tagId, orgId);
	const name = current.name ?? '(unnamed)';
	const scope: MutationScope = { scopeId: tagId, scopeName: name, orgId, orgName };
	const summary = `Delete tag "${name}" (${tagId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const { data, errors } = await ctx.session.rawGraphql(DELETE_TAG, { id: tagId });
		throwOnGraphqlErrors(errors);
		const deletedId = (data as { deleteTag?: string | null } | undefined)?.deleteTag;
		if (!deletedId) throw new Error('deleteTag returned no id; the mutation may have failed.');
		return JSON.stringify({ status: 'deleted', id: deletedId, name }, null, 2);
	});
}

export const TAG_MUTATE_CAPABILITIES: Capability[] = [
	{ spec: createTagSpec, access: 'write', chat: false, mcp: true, run: runCreateTag },
	{ spec: updateTagSpec, access: 'write', chat: false, mcp: true, run: runUpdateTag },
	{ spec: deleteTagSpec, access: 'write', chat: false, mcp: true, run: runDeleteTag },
];
