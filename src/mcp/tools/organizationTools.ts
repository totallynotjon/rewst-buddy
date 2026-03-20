import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveSession } from './resolveSession';
import { searchOrgsSchema, getOrganizationSchema } from './schemas';

const SEARCH_ORGS_QUERY = `
	query SearchManagedOrgs($input: SearchManagedOrgsInput!) {
		searchManagedOrgs(input: $input) { id name }
	}
`;

const GET_ORGANIZATION_QUERY = `
	query GetOrganization($where: OrganizationWhereInput) {
		organization(where: $where) {
			id name domain managingOrgId isEnabled isOnboarding
			createdAt orgSlug
			managingOrg { id name }
			tags { id name color }
		}
	}
`;

export function registerOrganizationTools(server: McpServer): void {
	server.registerTool(
		'rewst_search_orgs',
		{
			title: 'Search Organizations',
			description:
				'Search managed organizations by name. Returns matching orgs with their IDs. Use rewst_get_organization to get full details for a specific org.',
			inputSchema: searchOrgsSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ search, limit, offset, orgId }) => {
			const session = resolveSession(orgId);

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const result: { searchManagedOrgs: { id: string; name: string }[] } = await session.client.request(
				SEARCH_ORGS_QUERY,
				{ input: { search, limit: limit ?? 25, offset: offset ?? 0 } },
			);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.searchManagedOrgs, null, 2) }],
			};
		},
	);

	server.registerTool(
		'rewst_get_organization',
		{
			title: 'Get Organization',
			description: 'Get full details for a specific organization by ID.',
			inputSchema: getOrganizationSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ organizationId }) => {
			const session = resolveSession();

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const result: { organization: Record<string, unknown> } = await session.client.request(
				GET_ORGANIZATION_QUERY,
				{ where: { id: organizationId } },
			);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.organization, null, 2) }],
			};
		},
	);
}
