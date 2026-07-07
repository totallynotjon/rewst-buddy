/**
 * JinjaPreviewPanel — a side WebviewPanel that live-renders the active linked
 * template (or selection) against a user-picked execution context.
 *
 * One panel per document URI. A second call for the same URI reveals the
 * existing panel instead of creating a duplicate.
 */

import { context as extContext } from '@global';
import { LinkManager, orgForTemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { createGraphqlDeps } from '../chat/tools/graphqlTool';
import { mergeExecutionContext, pickJinjaExecutionContext } from '../JinjaPreviewContext';
import { getLastContext, saveLastContext } from '../../models/JinjaPreviewContextStore';
import { evaluateRenderJinja } from '../../workflow/executions';

// Module-level panel registry: one panel per document URI string.
const panels = new Map<string, vscode.WebviewPanel>();

export const JinjaPreviewPanel = {
	/**
	 * Open or reveal the Jinja preview panel for the given document URI.
	 * Called by the PreviewJinjaRender command after it has verified the file
	 * is linked — all further logic (session resolution, context pick, render)
	 * lives here.
	 */
	async createOrShow(uri: vscode.Uri, extensionUri: vscode.Uri): Promise<void> {
		const uriKey = uri.toString();

		// Reveal existing panel if one is already open for this URI.
		const existing = panels.get(uriKey);
		if (existing) {
			existing.reveal(vscode.ViewColumn.Beside);
			return;
		}

		// Resolve link, org, session, deps.
		const link = LinkManager.getTemplateLink(uri);
		const org = orgForTemplateLink(link);
		const session = await SessionManager.getSessionForOrg(org.id);
		const deps = createGraphqlDeps(session);

		// Create the panel.
		const panel = vscode.window.createWebviewPanel(
			'rewst-buddy.jinjaPreview',
			`Rewst Jinja Preview — ${link.template.name}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
			},
		);
		panels.set(uriKey, panel);

		// Per-panel mutable state (never persisted).
		let mergedVars: Record<string, unknown> | undefined;
		let debounceTimer: ReturnType<typeof setTimeout> | undefined;

		// Render helpers.
		const postState = (state: object) => {
			void panel.webview.postMessage(state);
		};

		const doRender = async () => {
			if (!mergedVars) return;
			// Re-resolve session fresh on every render tick (cheap — ensureValid is cache-backed).
			let freshSession: Awaited<ReturnType<typeof SessionManager.getSessionForOrg>>;
			try {
				freshSession = await SessionManager.getSessionForOrg(org.id);
			} catch (e) {
				postState({ type: 'error', message: `Session error: ${e instanceof Error ? e.message : String(e)}` });
				return;
			}
			const freshDeps = createGraphqlDeps(freshSession);

			// Determine template text: selection if non-empty, else full document.
			const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uriKey);
			const templateText =
				editor && !editor.selection.isEmpty
					? editor.document.getText(editor.selection)
					: (editor?.document.getText() ?? '');

			try {
				const outcome = await evaluateRenderJinja(freshDeps, org.id, templateText, mergedVars);
				if (!outcome.ok) {
					postState({ type: 'jinjaError', message: outcome.jinjaError ?? 'Jinja error' });
				} else {
					postState({
						type: 'render',
						value: outcome.value,
						hasControlCharacter: outcome.hasControlCharacter ?? false,
					});
				}
			} catch (e) {
				postState({ type: 'error', message: e instanceof Error ? e.message : String(e) });
			}
		};

		const scheduleRender = () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				void doRender();
			}, 300);
		};

		// Set initial HTML.
		panel.webview.html = getHtml(panel.webview, extensionUri);

		// Load remembered context if available.
		const remembered = getLastContext(extContext, link.template.id);
		if (remembered) {
			try {
				mergedVars = await mergeExecutionContext(deps, remembered.executionId);
				postState({
					type: 'contextLoaded',
					workflowName: remembered.workflowName,
					executionId: remembered.executionId,
				});
				void doRender();
			} catch (e) {
				// Stale execution — show error state and offer re-pick.
				mergedVars = undefined;
				postState({ type: 'noContext', error: e instanceof Error ? e.message : String(e) });
			}
		} else {
			postState({ type: 'noContext' });
		}

		// Handle messages from the webview.
		const msgDisposable = panel.webview.onDidReceiveMessage(async (msg: { type: string }) => {
			if (msg.type === 'pickContext') {
				const entry = await pickJinjaExecutionContext(deps, org.id);
				if (!entry) return;
				saveLastContext(extContext, link.template.id, entry);
				try {
					mergedVars = await mergeExecutionContext(deps, entry.executionId);
					postState({
						type: 'contextLoaded',
						workflowName: entry.workflowName,
						executionId: entry.executionId,
					});
					void doRender();
				} catch (e) {
					postState({ type: 'error', message: e instanceof Error ? e.message : String(e) });
				}
			}
		});

		// Debounced document-change listener (filtered to this document).
		const docChangeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === uriKey) scheduleRender();
		});

		// Debounced selection-change listener (filtered to this document).
		const selChangeDisposable = vscode.window.onDidChangeTextEditorSelection(e => {
			if (e.textEditor.document.uri.toString() === uriKey) scheduleRender();
		});

		// Cleanup on panel close.
		panel.onDidDispose(() => {
			panels.delete(uriKey);
			if (debounceTimer) clearTimeout(debounceTimer);
			msgDisposable.dispose();
			docChangeDisposable.dispose();
			selChangeDisposable.dispose();
		});
	},
};

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'main.css'));
	const nonce = getNonce();
	// Pre-built as a TS string so single-quote escaping is unambiguous to ESLint.
	const controlCharWarningHtml =
		'<div class="warning-banner">WARNING \u2014 rendered result contains a control character.' +
		" If this came from regex_replace backreference escaping, use '\\\\\\\\1' instead of '\\\\1'.</div>";

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Rewst Jinja Preview</title>
	<style nonce="${nonce}">
		.preview-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border, #444); }
		.preview-toolbar button { cursor: pointer; }
		.context-label { font-size: 0.85em; color: var(--vscode-descriptionForeground, #888); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.preview-output { padding: 12px; font-family: var(--vscode-editor-font-family, monospace); white-space: pre-wrap; word-break: break-all; }
		.error-banner { padding: 8px 12px; background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-inputValidation-errorForeground, #f48771); border-left: 3px solid var(--vscode-inputValidation-errorBorder, #f48771); margin: 8px; }
		.warning-banner { padding: 6px 12px; background: var(--vscode-inputValidation-warningBackground, #352a05); color: var(--vscode-inputValidation-warningForeground, #cca700); border-left: 3px solid var(--vscode-inputValidation-warningBorder, #cca700); margin: 8px; font-size: 0.85em; }
		.no-context { padding: 24px; text-align: center; color: var(--vscode-descriptionForeground, #888); }
	</style>
</head>
<body>
	<div class="preview-toolbar">
		<button id="pickContextBtn" type="button">$(eye) Pick Context</button>
		<span class="context-label" id="contextLabel">No context selected</span>
	</div>
	<div id="content">
		<div class="no-context">Click <strong>Pick Context</strong> to select a workflow execution, then edit the file to see the live render.</div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.getElementById('pickContextBtn').addEventListener('click', () => {
			vscode.postMessage({ type: 'pickContext' });
		});
		window.addEventListener('message', event => {
			const msg = event.data;
			const content = document.getElementById('content');
			const label = document.getElementById('contextLabel');
			if (msg.type === 'noContext') {
				label.textContent = msg.error ? 'Context error — pick again' : 'No context selected';
				content.innerHTML = msg.error
					? '<div class="error-banner">Could not load remembered context: ' + escHtml(msg.error) + '</div><div class="no-context">Click <strong>Pick Context</strong> to select a new execution.</div>'
					: '<div class="no-context">Click <strong>Pick Context</strong> to select a workflow execution, then edit the file to see the live render.</div>';
			} else if (msg.type === 'contextLoaded') {
				label.textContent = msg.workflowName + ' / ' + msg.executionId;
			} else if (msg.type === 'render') {
				const warning = msg.hasControlCharacter
					? controlCharWarningHtml
					: '';
				content.innerHTML = warning + '<div class="preview-output">' + escHtml(JSON.stringify(msg.value, null, 2)) + '</div>';
			} else if (msg.type === 'jinjaError') {
				content.innerHTML = '<div class="error-banner">Jinja error: ' + escHtml(msg.message) + '</div>';
			} else if (msg.type === 'error') {
				content.innerHTML = '<div class="error-banner">Error: ' + escHtml(msg.message) + '</div>';
			}
		});
		function escHtml(s) {
			return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
		}
	</script>
</body>
</html>`;
}
