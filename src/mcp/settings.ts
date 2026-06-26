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
	 * Org ids that are *always* in scope, regardless of the ephemeral working
	 * scope (see WorkingScopeManager). Enforcement folds these together with the
	 * working orgs into the effective allowed set: a write must target an org in
	 * that set, and under strict scope so must a read once a working org is pinned.
	 * Empty (the default) means nothing is standing-allowed, so with no working org
	 * pinned there is nothing to write to — the safe sandbox default behind #87.
	 */
	alwaysAllowedOrgs: string[];
	/**
	 * How the working scope constrains reads. 'strict' (default) scopes reads to
	 * the effective allowed set once a working org is pinned; 'writes' leaves reads
	 * cross-org and only gates writes.
	 */
	workingOrgScope: 'strict' | 'writes';
}

/** Coerces the user-supplied allowlist setting into trimmed, non-empty string ids. */
function normalizeAllowlist(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(entry => (typeof entry === 'string' ? entry.trim() : '')).filter(entry => entry.length > 0);
}

function readWorkingOrgScope(value: unknown): 'strict' | 'writes' {
	return value === 'writes' ? 'writes' : 'strict';
}

export function readMcpSettings(): McpSettings {
	const config = vscode.workspace.getConfiguration(`${extPrefix}.mcp`);
	// `alwaysAllowedOrgs` is the renamed `writeOrgAllowlist`; fall back to the old
	// key so existing user configs keep working until they migrate.
	const alwaysAllowedOrgs = normalizeAllowlist(
		config.get<unknown>('alwaysAllowedOrgs', undefined) ?? config.get<unknown>('writeOrgAllowlist', []),
	);
	return {
		enable: config.get<boolean>('enable', false),
		enableWriteTools: config.get<boolean>('enableWriteTools', false),
		enableDangerousGraphqlMutation: config.get<boolean>('enableDangerousGraphqlMutation', false),
		alwaysAllowedOrgs,
		workingOrgScope: readWorkingOrgScope(config.get<unknown>('workingOrgScope', 'strict')),
	};
}
