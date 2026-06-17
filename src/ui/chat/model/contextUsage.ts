/**
 * The latest context-window usage the Rewst backend reported for a Cage-Free
 * Rewsty turn. VS Code's native chat gauge can't be driven by a third-party
 * model provider (microsoft/vscode#309207, #313458), so the provider records
 * usage here and the status bar surfaces it instead.
 */
import vscode from 'vscode';

export interface ContextUsage {
	orgId: string;
	orgName?: string;
	totalTokens: number;
	maxTokens: number;
	percent: number;
}

let current: ContextUsage | undefined;
const emitter = new vscode.EventEmitter<ContextUsage>();

/** Fires whenever a turn reports fresh context usage. */
export const onDidChangeContextUsage = emitter.event;

export function setContextUsage(usage: ContextUsage): void {
	current = usage;
	emitter.fire(usage);
}

export function currentContextUsage(): ContextUsage | undefined {
	return current;
}
