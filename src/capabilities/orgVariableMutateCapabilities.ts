import { z } from 'zod';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	optionalBooleanField,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requireResourceInOrg,
	requiredStringAllowEmptyField,
	requiredStringField,
	toInputSchema,
} from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';

/**
 * Org-variable write capabilities. createOrgVariable carries orgId in its input
 * so it is natively org-scoped; update and delete act on a variable by id, and
 * one session can manage many orgs, so each first re-verifies the variable
 * belongs to the requested org (requireOrgVariableInOrg) before mutating. Every
 * mutation is approval-gated and hidden unless rewst-buddy.mcp.enableWriteTools.
 */

// Categories a caller may set. 'system' is reserved for Rewst-managed variables
// and is rejected rather than offered.
const SETTABLE_CATEGORIES = ['general', 'contact', 'secret'] as const;
type SettableCategory = (typeof SETTABLE_CATEGORIES)[number];

const categoryField = z
	.enum(SETTABLE_CATEGORIES, { error: `"category" must be one of ${SETTABLE_CATEGORIES.join(', ')}.` })
	.optional();

const CREATE_ORG_VARIABLE = `mutation RewstBuddyMcpCreateOrgVariable($orgVariable: OrgVariableCreateInput!) {
  createOrgVariable(orgVariable: $orgVariable) { id name category cascade orgId }
}`;

const UPDATE_ORG_VARIABLES = `mutation RewstBuddyMcpUpdateOrgVariables($orgVariables: [OrgVariableUpdateInput!]!) {
  updateOrgVariables(orgVariables: $orgVariables) { id name category cascade orgId }
}`;

const DELETE_ORG_VARIABLE = `mutation RewstBuddyMcpDeleteOrgVariable($id: ID!) {
  deleteOrgVariable(id: $id)
}`;

const ORG_VARIABLE_BY_ID = `query RewstBuddyMcpOrgVariableById($orgId: ID!, $id: ID!) {
  orgVariables(where: { orgId: $orgId, id: $id }, maskSecrets: true) { id name category cascade orgId }
}`;

interface OrgVariableRow {
	id?: string;
	name?: string;
	category?: string;
	cascade?: boolean;
	orgId?: string;
}

/**
 * Fetches a variable by id and fails closed unless it belongs to the requested
 * org. Returns the fields needed to build a safe update payload. The value is
 * never read here, so a secret value is not surfaced.
 */
async function requireOrgVariableInOrg(
	ctx: CapabilityContext,
	variableId: string,
	orgId: string,
): Promise<OrgVariableRow> {
	return requireResourceInOrg({
		label: 'Org variable',
		id: variableId,
		orgId,
		fetch: async () => {
			const data = await rawGraphqlOrThrow(ctx.session, ORG_VARIABLE_BY_ID, { orgId, id: variableId });
			const rows = ((data as { orgVariables?: OrgVariableRow[] } | undefined)?.orgVariables ??
				[]) as OrgVariableRow[];
			return rows.find(r => r.id === variableId);
		},
		// The query is already org-filtered, so a returned row is in-org by construction.
		inOrg: () => true,
	});
}

const createOrgVariableSchema = z.object({
	orgId: ORG_ID_FIELD,
	name: requiredStringField('name').describe('Variable name.'),
	value: requiredStringAllowEmptyField('value').describe('Variable value; may be an empty string.'),
	category: categoryField.describe('Variable category (default general). secret masks the value in reads.'),
	cascade: optionalBooleanField('cascade').describe('Whether descendant orgs inherit the variable (default false).'),
});

const createOrgVariableSpec: ToolSpecDefinition = {
	name: 'buddy_create_org_variable',
	description:
		'Create a configuration variable in one Rewst organization. category defaults to general (use secret for sensitive values); cascade (default false) makes the variable visible to descendant orgs. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(createOrgVariableSchema),
};

async function runCreateOrgVariable(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const {
		orgId,
		name,
		value,
		category: categoryInput,
		cascade: cascadeInput,
	} = parseCapabilityInput(createOrgVariableSchema, input);
	const category: SettableCategory = categoryInput ?? 'general';
	const cascade = cascadeInput ?? false;
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: orgId, scopeName: `new variable "${name}"`, orgId, orgName };
	const summary = `Create ${category} variable "${name}" in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const data = await rawGraphqlOrThrow(ctx.session, CREATE_ORG_VARIABLE, {
			orgVariable: { orgId, name, value, category, cascade },
		});
		const created = (data as { createOrgVariable?: OrgVariableRow } | undefined)?.createOrgVariable;
		if (!created?.id) throw new Error('createOrgVariable returned no variable; the mutation may have failed.');
		return JSON.stringify({ status: 'created', id: created.id, name: created.name ?? name }, null, 2);
	});
}

const updateOrgVariableSchema = z.object({
	orgId: ORG_ID_FIELD,
	variableId: requiredStringField('variableId').describe('Id of the variable to update.'),
	value: requiredStringAllowEmptyField('value').describe('New value; may be an empty string.'),
	category: categoryField.describe("Optional new category; defaults to the variable's current category."),
	cascade: optionalBooleanField('cascade').describe('Optional new cascade flag; defaults to the current value.'),
});

const updateOrgVariableSpec: ToolSpecDefinition = {
	name: 'buddy_update_org_variable',
	description:
		'Replace the value of one existing org variable, identified by org and variable id. The variable must belong to the given org. Optionally also change its category or cascade; the name is preserved. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(updateOrgVariableSchema),
};

async function runUpdateOrgVariable(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const {
		orgId,
		variableId,
		value,
		category: categoryOverride,
		cascade: cascadeOverride,
	} = parseCapabilityInput(updateOrgVariableSchema, input);
	const orgName = orgDisplayName(ctx);
	const current = await requireOrgVariableInOrg(ctx, variableId, orgId);
	const name = current.name ?? '';
	if (!name) throw new Error(`Org variable ${variableId} has no name; refusing to update.`);
	const category = categoryOverride ?? current.category ?? 'general';
	const cascade = cascadeOverride ?? current.cascade ?? false;
	const scope: MutationScope = { scopeId: variableId, scopeName: name, orgId, orgName };
	const summary = `Update variable "${name}" (${variableId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const data = await rawGraphqlOrThrow(ctx.session, UPDATE_ORG_VARIABLES, {
			orgVariables: [{ id: variableId, orgId, name, value, category, cascade }],
		});
		const rows = ((data as { updateOrgVariables?: OrgVariableRow[] } | undefined)?.updateOrgVariables ??
			[]) as OrgVariableRow[];
		const updated = rows.find(r => r.id === variableId) ?? rows[0];
		if (!updated?.id) throw new Error('updateOrgVariables returned no variable; the mutation may have failed.');
		return JSON.stringify({ status: 'updated', id: updated.id, name: updated.name ?? name }, null, 2);
	});
}

const deleteOrgVariableSchema = z.object({
	orgId: ORG_ID_FIELD,
	variableId: requiredStringField('variableId').describe('Id of the variable to delete.'),
});

const deleteOrgVariableSpec: ToolSpecDefinition = {
	name: 'buddy_delete_org_variable',
	description:
		'Permanently delete one org variable, identified by org and variable id. The variable must belong to the given org. This cannot be undone. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(deleteOrgVariableSchema),
};

async function runDeleteOrgVariable(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, variableId } = parseCapabilityInput(deleteOrgVariableSchema, input);
	const orgName = orgDisplayName(ctx);
	const current = await requireOrgVariableInOrg(ctx, variableId, orgId);
	const name = current.name ?? '(unnamed)';
	const scope: MutationScope = { scopeId: variableId, scopeName: name, orgId, orgName };
	const summary = `Delete variable "${name}" (${variableId}) in org "${orgName}" (${orgId})`;
	// A delete always prompts fresh: approval scopes key only on [orgId, resourceId],
	// so without this a prior non-delete approval for this same variable would
	// otherwise silently pre-approve deleting it too (#177).
	return withMutationApproval(
		scope,
		summary,
		async () => {
			const data = await rawGraphqlOrThrow(ctx.session, DELETE_ORG_VARIABLE, { id: variableId });
			const deletedId = (data as { deleteOrgVariable?: string | null } | undefined)?.deleteOrgVariable;
			if (!deletedId) throw new Error('deleteOrgVariable returned no id; the mutation may have failed.');
			return JSON.stringify({ status: 'deleted', id: deletedId, name }, null, 2);
		},
		{ alwaysPrompt: true },
	);
}

export const ORG_VARIABLE_MUTATE_CAPABILITIES: Capability[] = [
	writeCapability(createOrgVariableSpec, runCreateOrgVariable),
	writeCapability(updateOrgVariableSpec, runUpdateOrgVariable),
	writeCapability(deleteOrgVariableSpec, runDeleteOrgVariable),
];
