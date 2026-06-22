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
	/**
	 * Org ids that write tools may target. Empty means "any managed org" (the
	 * default). When non-empty, a write whose orgId is not listed is rejected at
	 * the MCP boundary before it runs — a hard, declarative blast-radius cap that
	 * does not depend on the approval modal (which an external MCP client's user
	 * may never see).
	 */
	writeOrgAllowlist: string[];
}

/** Coerces the user-supplied allowlist setting into trimmed, non-empty string ids. */
function normalizeAllowlist(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(entry => (typeof entry === 'string' ? entry.trim() : '')).filter(entry => entry.length > 0);
}

export function readMcpSettings(): McpSettings {
	const config = vscode.workspace.getConfiguration(`${extPrefix}.mcp`);
	return {
		enable: config.get<boolean>('enable', false),
		enableWriteTools: config.get<boolean>('enableWriteTools', false),
		enableDangerousGraphqlMutation: config.get<boolean>('enableDangerousGraphqlMutation', false),
		writeOrgAllowlist: normalizeAllowlist(config.get<unknown>('writeOrgAllowlist', [])),
	};
}
