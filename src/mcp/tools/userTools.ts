import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveSession } from './resolveSession';
import { getCurrentUserSchema } from './schemas';

export function registerUserTools(server: McpServer): void {
	server.registerTool(
		'rewst_get_current_user',
		{
			title: 'Get Current User',
			description: 'Get the current user info and their managed organizations',
			inputSchema: getCurrentUserSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ orgId }) => {
			const session = resolveSession(orgId);
			const result = await session.sdk!.User();

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.user, null, 2) }],
			};
		},
	);
}
