import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SessionManager } from '@sessions';
import { resolveSession } from './resolveSession';
import { optionalOrgId } from './schemas';

export function registerSessionTools(server: McpServer): void {
	server.registerTool(
		'rewst_list_sessions',
		{
			title: 'List Sessions',
			description:
				'List all active Rewst sessions. Shows the authenticated user, their org, and region. Use rewst_list_managed_orgs to see all managed organizations for a session.',
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
				managedOrgCount: s.profile.allManagedOrgs.length,
			}));

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
			};
		},
	);

	server.registerTool(
		'rewst_list_managed_orgs',
		{
			title: 'List Managed Organizations',
			description:
				'List all managed organizations for a session. Use this to find orgId values for template operations on sub-organizations.',
			inputSchema: optionalOrgId,
			annotations: { readOnlyHint: true },
		},
		async ({ orgId }) => {
			const session = resolveSession(orgId);
			const orgs = session.profile.allManagedOrgs.map(o => ({
				id: o.id,
				name: o.name,
			}));

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(orgs, null, 2) }],
			};
		},
	);
}
