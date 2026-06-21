import { extPrefix } from '@global';
import vscode from 'vscode';

/**
 * The opt-in Rewst MCP capability families, configured as a single checklist setting
 * `rewst-buddy.ai.tools` (an enum array VS Code renders as checkboxes). This
 * replaced the individual `enable…Tools` booleans. `workspace` is on by default;
 * `graphql` and `workflows` are opt-in.
 */
const ALL_CAPABILITIES = ['workspace', 'graphql', 'workflows'] as const;

export type AiToolCapability = (typeof ALL_CAPABILITIES)[number];

const DEFAULT_TOOLS: AiToolCapability[] = ['workspace'];

/** The set of enabled MCP capability families from `rewst-buddy.ai.tools`. */
export function enabledAiTools(): Set<string> {
	return new Set(vscode.workspace.getConfiguration(`${extPrefix}.ai`).get<string[]>('tools', DEFAULT_TOOLS));
}

/** Whether a given MCP capability family is checked in `rewst-buddy.ai.tools`. */
export function isAiToolEnabled(capability: AiToolCapability): boolean {
	return enabledAiTools().has(capability);
}
