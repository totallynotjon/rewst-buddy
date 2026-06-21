import { extPrefix } from '@global';
import vscode from 'vscode';

/**
 * The opt-in AI tool capabilities, configured as a single checklist setting
 * `rewst-buddy.ai.tools` (an enum array VS Code renders as checkboxes). This
 * replaced the individual `enable…Tools` booleans. `workspace` is on by default;
 * `graphql` and `workflows` are opt-in.
 */
const ALL_CAPABILITIES = ['workspace', 'graphql', 'workflows'] as const;

export type AiToolCapability = (typeof ALL_CAPABILITIES)[number];

const DEFAULT_TOOLS: AiToolCapability[] = ['workspace'];

/** The set of enabled tool capabilities from `rewst-buddy.ai.tools`. */
export function enabledAiTools(): Set<string> {
	return new Set(vscode.workspace.getConfiguration(`${extPrefix}.ai`).get<string[]>('tools', DEFAULT_TOOLS));
}

/** Whether a given tool capability is checked in `rewst-buddy.ai.tools`. */
export function isAiToolEnabled(capability: AiToolCapability): boolean {
	return enabledAiTools().has(capability);
}

/** Whether any known tool capability is enabled (unknown config values don't count). */
export function anyAiToolEnabled(): boolean {
	const tools = enabledAiTools();
	return ALL_CAPABILITIES.some(capability => tools.has(capability));
}
