import { extPrefix } from '@global';
import vscode from 'vscode';

/** The rewst-buddy.mcp.* switches that govern the MCP server surface. */
export interface McpSettings {
	/** Master switch; when false the /mcp endpoint rejects every request. */
	enable: boolean;
	/** Allows access:'write' capabilities through the MCP boundary. */
	enableWriteTools: boolean;
	/** Allows the raw GraphQL mutation capability through the MCP boundary. */
	enableDangerousGraphqlMutation: boolean;
}

export function readMcpSettings(): McpSettings {
	const config = vscode.workspace.getConfiguration(`${extPrefix}.mcp`);
	return {
		enable: config.get<boolean>('enable', false),
		enableWriteTools: config.get<boolean>('enableWriteTools', false),
		enableDangerousGraphqlMutation: config.get<boolean>('enableDangerousGraphqlMutation', false),
	};
}
