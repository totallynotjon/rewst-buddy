import { extPrefix } from '@global';
import vscode from 'vscode';

/** The rewst-buddy.mcp.* switches that govern the MCP server surface. */
export interface McpSettings {
	/** Master switch; when false no MCP action runs and no discovery file is written. */
	enable: boolean;
	/** Allows access:'write' capabilities through the MCP boundary. */
	enableWriteTools: boolean;
	/**
	 * Allowlist of capability names exposed over MCP. Empty array means "all
	 * enabled read tools" (the default); a non-empty list restricts to those names.
	 */
	enabledTools: string[];
}

export function readMcpSettings(): McpSettings {
	const config = vscode.workspace.getConfiguration(`${extPrefix}.mcp`);
	const enabledTools = config.get<string[]>('enabledTools', []);
	return {
		enable: config.get<boolean>('enable', false),
		enableWriteTools: config.get<boolean>('enableWriteTools', false),
		enabledTools: Array.isArray(enabledTools) ? enabledTools : [],
	};
}
