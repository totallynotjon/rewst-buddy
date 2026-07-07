/**
 * Persists the last-picked Jinja preview context (workflow id/name, org id,
 * execution id) per linked template id in globalState.
 *
 * Only the four identifying fields are persisted — never the merged vars object
 * (too large; re-derived on panel load via mergeExecutionContext).
 */

import vscode from 'vscode';

export interface JinjaPreviewContextEntry {
	workflowId: string;
	workflowName: string;
	orgId: string;
	executionId: string;
}

const STATE_KEY = 'RewstJinjaPreviewContext';

type ContextMap = Record<string, JinjaPreviewContextEntry>;

export function getLastContext(
	context: vscode.ExtensionContext,
	templateId: string,
): JinjaPreviewContextEntry | undefined {
	const map = context.globalState.get<ContextMap>(STATE_KEY) ?? {};
	return map[templateId];
}

export function saveLastContext(
	context: vscode.ExtensionContext,
	templateId: string,
	entry: JinjaPreviewContextEntry,
): void {
	const map = context.globalState.get<ContextMap>(STATE_KEY) ?? {};
	const updated: ContextMap = { ...map, [templateId]: entry };
	void context.globalState.update(STATE_KEY, updated);
}
