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
	 * Allowlist of capability names exposed over MCP. Empty array means "all
	 * capabilities allowed by the MCP switches" (the default); a non-empty list
	 * restricts to those names.
	 */
	enabledTools: string[];
}

export function readMcpSettings(): McpSettings {
	const config = vscode.workspace.getConfiguration(`${extPrefix}.mcp`);
	const rawEnabledTools = config.get<unknown>('enabledTools');
	// `[]` means "all enabled read tools", so a malformed value must not silently
	// fall through to that — it would broaden exposure on a config typo. A
	// non-array, or an array carrying any non-string/blank entry, counts as
	// malformed. Sanitizing bad entries down to `[]` would also widen exposure, so
	// fail closed: disable the server entirely until the config is valid.
	const hasInvalidEntries =
		Array.isArray(rawEnabledTools) &&
		rawEnabledTools.some(value => typeof value !== 'string' || value.trim().length === 0);
	const malformedEnabledTools =
		rawEnabledTools !== undefined && (!Array.isArray(rawEnabledTools) || hasInvalidEntries);
	const enabledTools = Array.isArray(rawEnabledTools)
		? rawEnabledTools
				.filter((value): value is string => typeof value === 'string')
				.map(value => value.trim())
				.filter(Boolean)
		: [];
	return {
		enable: !malformedEnabledTools && config.get<boolean>('enable', false),
		enableWriteTools: !malformedEnabledTools && config.get<boolean>('enableWriteTools', false),
		enableDangerousGraphqlMutation:
			!malformedEnabledTools && config.get<boolean>('enableDangerousGraphqlMutation', false),
		enabledTools,
	};
}
