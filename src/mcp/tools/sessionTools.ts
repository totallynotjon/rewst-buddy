import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SessionManager } from '@sessions';

export function registerSessionTools(server: McpServer): void {
	server.registerTool(
		'rewst_list_sessions',
		{
			title: 'List Sessions',
			description: 'List all active Rewst sessions with org info. Use this to find orgId values for other tools.',
		},
		async () => {
			const sessions = SessionManager.getActiveSessions();

			if (sessions.length === 0) {
				return {
					content: [
						{
							type: 'text' as const,
							text: 'No active sessions. Open VS Code and create a Rewst session first.',
						},
					],
				};
			}

			const data = sessions.map(s => ({
				label: s.profile.label,
				org: { id: s.profile.org.id, name: s.profile.org.name },
				region: s.profile.region.name,
				managedOrgs: s.profile.allManagedOrgs.map(o => ({ id: o.id, name: o.name })),
			}));

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
			};
		},
	);
}
