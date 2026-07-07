import { z } from 'zod';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	optionalClampedInt,
	optionalStringField,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	toInputSchema,
} from './inputHelpers';

const SEARCH_ORGANIZATIONS_QUERY =
	'query($search: String, $limit: Int){ searchManagedOrgs(input:{ search:$search, limit:$limit }){ id name isEnabled } }';
const LIST_USERS_QUERY =
	'query($orgId: ID!, $search: UserSearchInput, $limit: Int){ users(where:{ orgId:$orgId }, search:$search, limit:$limit){ id username isApiUser roleIds } }';
const LIST_ROLES_QUERY = 'query($orgId: ID!){ roles(where:{ orgId:$orgId }){ id name description } }';

const searchOrganizationsInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	search: optionalStringField().describe('Optional case-insensitive name substring.'),
	limit: optionalClampedInt(100).describe('Max organizations to return (default 25, max 100).'),
});

const listUsersInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	search: optionalStringField().describe('Optional username substring.'),
	limit: optionalClampedInt(200).describe('Max users to return (default 50, max 200).'),
});

const listRolesInputSchema = z.object({
	orgId: ORG_ID_FIELD,
});

const searchOrganizationsSpec: ToolSpecDefinition = {
	name: 'buddy_search_organizations',
	description:
		'Find organizations by a case-insensitive name substring. orgId only selects which signed-in session to use — results are not limited to that org; they span all organizations the session manages. Returns id, name, isEnabled. Preferred over buddy_list_orgs for finding an org by name (buddy_list_orgs enumerates every managed org).',
	inputSchema: toInputSchema(searchOrganizationsInputSchema),
};

const listUsersSpec: ToolSpecDefinition = {
	name: 'buddy_list_users',
	description:
		'List the users directly in one Rewst organization (id, username, isApiUser, roleIds). Only users in the named org are returned; parent-org users are not inherited.',
	inputSchema: toInputSchema(listUsersInputSchema),
};

const listRolesSpec: ToolSpecDefinition = {
	name: 'buddy_list_roles',
	description: 'List the roles defined in one Rewst organization (id, name, description).',
	inputSchema: toInputSchema(listRolesInputSchema),
};

async function runSearchOrganizations(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { limit: rawLimit, search } = parseCapabilityInput(searchOrganizationsInputSchema, input);
	const limit = rawLimit ?? 25;
	const variables: Record<string, unknown> = { limit };
	if (search) variables.search = search;
	const data = await rawGraphqlOrThrow(ctx.session, SEARCH_ORGANIZATIONS_QUERY, variables);
	const organizations = ((data as { searchManagedOrgs?: unknown[] } | undefined)?.searchManagedOrgs ?? []) as {
		id?: string;
		name?: string;
		isEnabled?: boolean;
	}[];
	if (organizations.length === 0) return 'No organizations found.';
	return organizations
		.map(org => `${org.name ?? '(unnamed)'} (${org.id})${org.isEnabled ? '' : ' [disabled]'}`)
		.join('\n');
}

async function runListUsers(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, search, limit: rawLimit } = parseCapabilityInput(listUsersInputSchema, input);
	const limit = rawLimit ?? 50;
	const variables: Record<string, unknown> = { orgId, limit };
	if (search) variables.search = { username: { _ilike: `%${search}%` } };
	const data = await rawGraphqlOrThrow(ctx.session, LIST_USERS_QUERY, variables);
	const users = ((data as { users?: unknown[] } | undefined)?.users ?? []) as {
		id?: string;
		username?: string;
		isApiUser?: boolean;
		roleIds?: unknown[];
	}[];
	if (users.length === 0) return 'No users found for this organization.';
	return users
		.map(
			user =>
				`${user.username ?? '(unnamed)'} (${user.id})${user.isApiUser ? ' [api]' : ''}${
					user.roleIds?.length ? ` — roles: ${user.roleIds.join(', ')}` : ''
				}`,
		)
		.join('\n');
}

async function runListRoles(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId } = parseCapabilityInput(listRolesInputSchema, input);
	const variables: Record<string, unknown> = { orgId };
	const data = await rawGraphqlOrThrow(ctx.session, LIST_ROLES_QUERY, variables);
	const roles = ((data as { roles?: unknown[] } | undefined)?.roles ?? []) as {
		id?: string;
		name?: string;
		description?: string | null;
	}[];
	if (roles.length === 0) return 'No roles found for this organization.';
	return roles
		.map(role => `${role.name ?? '(unnamed)'} (${role.id})${role.description ? ' — ' + role.description : ''}`)
		.join('\n');
}

export const ORG_USER_CAPABILITIES: Capability[] = [
	readCapability(searchOrganizationsSpec, runSearchOrganizations),
	readCapability(listUsersSpec, runListUsers),
	readCapability(listRolesSpec, runListRoles),
];
