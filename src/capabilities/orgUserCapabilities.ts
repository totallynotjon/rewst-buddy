import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { asString, requireString, asPositiveInt, ORG_ID_PROP } from './inputHelpers';

const SEARCH_ORGANIZATIONS_QUERY =
	'query($search: String, $limit: Int){ searchManagedOrgs(input:{ search:$search, limit:$limit }){ id name isEnabled } }';
const LIST_USERS_QUERY =
	'query($orgId: ID!, $search: UserSearchInput, $limit: Int){ users(where:{ orgId:$orgId }, search:$search, limit:$limit){ id username isApiUser roleIds } }';
const LIST_ROLES_QUERY = 'query($orgId: ID!){ roles(where:{ orgId:$orgId }){ id name description } }';

const searchOrganizationsSpec: ToolSpec = {
	name: 'search_organizations',
	args: '{"orgId": string, "search"?: string, "limit"?: number}',
	description:
		'Find organizations by a case-insensitive name substring. orgId only selects which signed-in session to use — results are not limited to that org; they span all organizations the session manages. Returns id, name, isEnabled. Preferred over list_orgs for finding an org by name (list_orgs enumerates every managed org).',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			search: { type: 'string', description: 'Optional case-insensitive name substring.' },
			limit: { type: 'integer', description: 'Max organizations to return (default 25, max 100).' },
		},
		required: ['orgId'],
	},
};

const listUsersSpec: ToolSpec = {
	name: 'list_users',
	args: '{"orgId": string, "search"?: string, "limit"?: number}',
	description:
		'List the users directly in one Rewst organization (id, username, isApiUser, roleIds). Only users in the named org are returned; parent-org users are not inherited.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			search: { type: 'string', description: 'Optional username substring.' },
			limit: { type: 'integer', description: 'Max users to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
};

const listRolesSpec: ToolSpec = {
	name: 'list_roles',
	args: '{"orgId": string}',
	description: 'List the roles defined in one Rewst organization (id, name, description).',
	inputSchema: { type: 'object', properties: { ...ORG_ID_PROP }, required: ['orgId'] },
};

async function runSearchOrganizations(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	requireString(input, 'orgId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? 25, 100);
	const search = asString(input, 'search');
	const variables: Record<string, unknown> = { limit };
	if (search) variables.search = search;
	const { data, errors } = await ctx.session.rawGraphql(SEARCH_ORGANIZATIONS_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
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
	const orgId = requireString(input, 'orgId');
	const search = asString(input, 'search');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? 50, 200);
	const variables: Record<string, unknown> = { orgId, limit };
	if (search) variables.search = { username: { _ilike: `%${search}%` } };
	const { data, errors } = await ctx.session.rawGraphql(LIST_USERS_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
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
	const orgId = requireString(input, 'orgId');
	const variables: Record<string, unknown> = { orgId };
	const { data, errors } = await ctx.session.rawGraphql(LIST_ROLES_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
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
	{ spec: searchOrganizationsSpec, access: 'read', chat: false, mcp: true, run: runSearchOrganizations },
	{ spec: listUsersSpec, access: 'read', chat: false, mcp: true, run: runListUsers },
	{ spec: listRolesSpec, access: 'read', chat: false, mcp: true, run: runListRoles },
];
