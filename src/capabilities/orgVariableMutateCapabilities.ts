import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import {
	ORG_ID_PROP,
	rawGraphqlOrThrow,
	requireResourceInOrg,
	requireString,
	requireStringAllowEmpty,
	throwOnGraphqlErrors,
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
const SETTABLE_CATEGORIES = new Set(['general', 'contact', 'secret']);

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

/** Reads an optional category argument, rejecting unknown or reserved values. */
function optionalCategory(input: Record<string, unknown>): string | undefined {
	const value = input.category;
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string' || !SETTABLE_CATEGORIES.has(value)) {
		throw new Error(`"category" must be one of ${[...SETTABLE_CATEGORIES].join(', ')}.`);
	}
	return value;
}

/** Reads an optional boolean argument; non-booleans are an error, not coerced. */
function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
	const value = input[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') throw new Error(`"${key}" must be a boolean.`);
	return value;
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

const createOrgVariableSpec: ToolSpec = {
	name: 'buddy_create_org_variable',
	args: '{"orgId": string, "name": string, "value": string, "category"?: "general"|"contact"|"secret", "cascade"?: boolean}',
	description:
		'Create a configuration variable in one Rewst organization. category defaults to general (use secret for sensitive values); cascade (default false) makes the variable visible to descendant orgs. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			name: { type: 'string', description: 'Variable name.' },
			value: { type: 'string', description: 'Variable value; may be an empty string.' },
			category: {
				type: 'string',
				enum: ['general', 'contact', 'secret'],
				description: 'Variable category (default general). secret masks the value in reads.',
			},
			cascade: { type: 'boolean', description: 'Whether descendant orgs inherit the variable (default false).' },
		},
		required: ['orgId', 'name', 'value'],
	},
};

async function runCreateOrgVariable(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const name = requireString(input, 'name');
	const value = requireStringAllowEmpty(input, 'value');
	const category = optionalCategory(input) ?? 'general';
	const cascade = optionalBoolean(input, 'cascade') ?? false;
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: orgId, scopeName: `new variable "${name}"`, orgId, orgName };
	const summary = `Create ${category} variable "${name}" in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const { data, errors } = await ctx.session.rawGraphql(CREATE_ORG_VARIABLE, {
			orgVariable: { orgId, name, value, category, cascade },
		});
		throwOnGraphqlErrors(errors);
		const created = (data as { createOrgVariable?: OrgVariableRow } | undefined)?.createOrgVariable;
		if (!created?.id) throw new Error('createOrgVariable returned no variable; the mutation may have failed.');
		return JSON.stringify({ status: 'created', id: created.id, name: created.name ?? name }, null, 2);
	});
}

const updateOrgVariableSpec: ToolSpec = {
	name: 'buddy_update_org_variable',
	args: '{"orgId": string, "variableId": string, "value": string, "category"?: "general"|"contact"|"secret", "cascade"?: boolean}',
	description:
		'Replace the value of one existing org variable, identified by org and variable id. The variable must belong to the given org. Optionally also change its category or cascade; the name is preserved. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			variableId: { type: 'string', description: 'Id of the variable to update.' },
			value: { type: 'string', description: 'New value; may be an empty string.' },
			category: {
				type: 'string',
				enum: ['general', 'contact', 'secret'],
				description: 'Optional new category; defaults to the variable’s current category.',
			},
			cascade: { type: 'boolean', description: 'Optional new cascade flag; defaults to the current value.' },
		},
		required: ['orgId', 'variableId', 'value'],
	},
};

async function runUpdateOrgVariable(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const variableId = requireString(input, 'variableId');
	const value = requireStringAllowEmpty(input, 'value');
	const categoryOverride = optionalCategory(input);
	const cascadeOverride = optionalBoolean(input, 'cascade');
	const orgName = orgDisplayName(ctx);
	const current = await requireOrgVariableInOrg(ctx, variableId, orgId);
	const name = current.name ?? '';
	if (!name) throw new Error(`Org variable ${variableId} has no name; refusing to update.`);
	const category = categoryOverride ?? current.category ?? 'general';
	const cascade = cascadeOverride ?? current.cascade ?? false;
	const scope: MutationScope = { scopeId: variableId, scopeName: name, orgId, orgName };
	const summary = `Update variable "${name}" (${variableId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const { data, errors } = await ctx.session.rawGraphql(UPDATE_ORG_VARIABLES, {
			orgVariables: [{ id: variableId, orgId, name, value, category, cascade }],
		});
		throwOnGraphqlErrors(errors);
		const rows = ((data as { updateOrgVariables?: OrgVariableRow[] } | undefined)?.updateOrgVariables ??
			[]) as OrgVariableRow[];
		const updated = rows.find(r => r.id === variableId) ?? rows[0];
		if (!updated?.id) throw new Error('updateOrgVariables returned no variable; the mutation may have failed.');
		return JSON.stringify({ status: 'updated', id: updated.id, name: updated.name ?? name }, null, 2);
	});
}

const deleteOrgVariableSpec: ToolSpec = {
	name: 'buddy_delete_org_variable',
	args: '{"orgId": string, "variableId": string}',
	description:
		'Permanently delete one org variable, identified by org and variable id. The variable must belong to the given org. This cannot be undone. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			variableId: { type: 'string', description: 'Id of the variable to delete.' },
		},
		required: ['orgId', 'variableId'],
	},
};

async function runDeleteOrgVariable(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const variableId = requireString(input, 'variableId');
	const orgName = orgDisplayName(ctx);
	const current = await requireOrgVariableInOrg(ctx, variableId, orgId);
	const name = current.name ?? '(unnamed)';
	const scope: MutationScope = { scopeId: variableId, scopeName: name, orgId, orgName };
	const summary = `Delete variable "${name}" (${variableId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const { data, errors } = await ctx.session.rawGraphql(DELETE_ORG_VARIABLE, { id: variableId });
		throwOnGraphqlErrors(errors);
		const deletedId = (data as { deleteOrgVariable?: string | null } | undefined)?.deleteOrgVariable;
		if (!deletedId) throw new Error('deleteOrgVariable returned no id; the mutation may have failed.');
		return JSON.stringify({ status: 'deleted', id: deletedId, name }, null, 2);
	});
}

export const ORG_VARIABLE_MUTATE_CAPABILITIES: Capability[] = [
	writeCapability(createOrgVariableSpec, runCreateOrgVariable),
	writeCapability(updateOrgVariableSpec, runUpdateOrgVariable),
	writeCapability(deleteOrgVariableSpec, runDeleteOrgVariable),
];
