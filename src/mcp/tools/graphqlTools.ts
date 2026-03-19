import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveSession } from './resolveSession';
import { introspectSchemaInput, executeGraphqlSchema } from './schemas';
import { getIntrospectionQuery } from 'graphql';

const introspectionCache = new Map<string, { data: string; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function registerGraphqlTools(server: McpServer): void {
	server.registerTool(
		'rewst_introspect_schema',
		{
			title: 'Introspect GraphQL Schema',
			description:
				'Run a GraphQL introspection query to discover the full API schema. Results are cached for 30 minutes per session.',
			inputSchema: introspectSchemaInput,
			annotations: { readOnlyHint: true },
		},
		async ({ orgId }) => {
			const session = resolveSession(orgId);
			const cacheKey = session.profile.org.id;
			const cached = introspectionCache.get(cacheKey);

			if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
				return {
					content: [{ type: 'text' as const, text: cached.data }],
				};
			}

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const query = getIntrospectionQuery();
			const result = await session.client.request(query);
			const text = JSON.stringify(result, null, 2);

			introspectionCache.set(cacheKey, { data: text, timestamp: Date.now() });

			return {
				content: [{ type: 'text' as const, text }],
			};
		},
	);

	server.registerTool(
		'rewst_execute_graphql',
		{
			title: 'Execute GraphQL',
			description:
				'Execute an arbitrary GraphQL query or mutation against the Rewst API. WARNING: This can run any operation including mutations that modify data.',
			inputSchema: executeGraphqlSchema,
			annotations: { readOnlyHint: false },
		},
		async ({ query, variables, orgId }) => {
			const session = resolveSession(orgId);

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const result = await session.client.request(query, variables ?? undefined);
			const text = JSON.stringify(result, null, 2);

			return {
				content: [{ type: 'text' as const, text }],
			};
		},
	);
}

export function clearIntrospectionCache(): void {
	introspectionCache.clear();
}
