/**
 * JinjaPreviewSession — orchestrates the three-pane native-editor Jinja live
 * preview: a real "vars/overrides" file, the template's own (untouched) tab,
 * and a read-only live-refreshing virtual "rendered output" document. Gives
 * back the native editor features (find, folding, minimap) a WebviewPanel
 * can't provide — see the removed JinjaPreviewPanel this replaces.
 *
 * One session per document URI. A second call for the same URI reveals the
 * existing panes instead of recreating them.
 */

import { LinkManager, WorkingScopeManager, orgForTemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { getLastContext, saveLastContext } from '../../models/JinjaPreviewContextStore';
import { evaluateRenderJinja } from '../../workflow/executions';
import { createGraphqlDeps } from '../chat/tools/graphqlTool';
import { type JinjaPreviewOrgPickItem, mergeExecutionContext, pickJinjaExecutionContext } from '../JinjaPreviewContext';
import { JinjaRenderedContentProvider } from './JinjaRenderedContentProvider';
import {
	formatInvalidOverrides,
	formatRenderedError,
	formatRenderedSuccess,
	mergeVars,
	OVERRIDES_SEED,
	parseOverrides,
	previewBaseName,
} from './jinjaPreviewRender';

const OVERRIDES_DIR = 'jinja-preview-vars';
const RENDER_DEBOUNCE_MS = 300;

export interface JinjaPreviewSessionState {
	templateUri: vscode.Uri;
	overridesUri: vscode.Uri;
	renderedUri: vscode.Uri;
	orgId: string;
	templateId: string;
	mergedVars?: Record<string, unknown>;
}

interface InternalState extends JinjaPreviewSessionState {
	debounceTimer?: ReturnType<typeof setTimeout>;
	disposables: vscode.Disposable[];
	overridesClosed: boolean;
	renderedClosed: boolean;
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function ensureOverridesFile(
	context: vscode.ExtensionContext,
	templateId: string,
	templateName: string,
): Promise<vscode.Uri> {
	const dir = vscode.Uri.joinPath(context.globalStorageUri, OVERRIDES_DIR);
	await vscode.workspace.fs.createDirectory(dir);
	const fileUri = vscode.Uri.joinPath(dir, `${previewBaseName(templateId, templateName)}.vars.jsonc`);
	if (!(await fileExists(fileUri))) {
		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(OVERRIDES_SEED, 'utf8'));
	}
	return fileUri;
}

/** Finds the ViewColumn of an already-open tab for this uri, if any — so a
 * window reload (which drops our in-memory session map but leaves VS Code's
 * restored tabs in place) reveals the existing tab instead of opening a
 * duplicate one beside it. */
function findOpenTabColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input;
			const tabUri =
				input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
			if (tabUri && tabUri.toString() === uri.toString()) return group.viewColumn;
		}
	}
	return undefined;
}

function buildOrgItems(anchorOrgId: string): JinjaPreviewOrgPickItem[] {
	const orgNames = new Map<string, string>();
	for (const activeSession of SessionManager.getActiveSessions()) {
		const { org: primaryOrg, allManagedOrgs } = activeSession.profile;
		if (primaryOrg?.id) orgNames.set(primaryOrg.id, primaryOrg.name ?? primaryOrg.id);
		for (const managed of allManagedOrgs ?? []) {
			if (managed?.id) orgNames.set(managed.id, managed.name ?? managed.id);
		}
	}

	const scopedOrgIds = new Set(WorkingScopeManager.getOrgs());
	const rank = (item: JinjaPreviewOrgPickItem) =>
		scopedOrgIds.has(item.orgId) ? 0 : item.orgId === anchorOrgId ? 1 : 2;

	return [...orgNames]
		.map(([orgId, orgName]) => ({
			label: orgName,
			description: orgId,
			detail: scopedOrgIds.has(orgId) ? 'In working scope' : orgId === anchorOrgId ? 'Template org' : undefined,
			orgId,
			orgName,
		}))
		.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

export const JinjaPreviewSession = new (class JinjaPreviewSessionImpl implements vscode.Disposable {
	private sessions = new Map<string, InternalState>();
	private closeListener: vscode.Disposable | undefined;

	init(): this {
		this.closeListener = vscode.workspace.onDidCloseTextDocument(doc => this.handleClose(doc.uri));
		return this;
	}

	private handleClose(closedUri: vscode.Uri): void {
		const closedKey = closedUri.toString();
		for (const [key, state] of this.sessions) {
			if (closedKey === state.overridesUri.toString()) state.overridesClosed = true;
			if (closedKey === state.renderedUri.toString()) state.renderedClosed = true;
			if (state.overridesClosed && state.renderedClosed) this.disposeSession(key);
		}
	}

	private disposeSession(key: string): void {
		const state = this.sessions.get(key);
		if (!state) return;
		if (state.debounceTimer) clearTimeout(state.debounceTimer);
		for (const d of state.disposables) d.dispose();
		JinjaRenderedContentProvider.clear(state.renderedUri);
		this.sessions.delete(key);
	}

	private async doRender(state: InternalState): Promise<void> {
		const isLive = () => this.sessions.get(state.templateUri.toString()) === state;
		const overridesDoc = await vscode.workspace.openTextDocument(state.overridesUri);
		const parsed = parseOverrides(overridesDoc.getText());
		if (parsed.error) {
			if (isLive()) JinjaRenderedContentProvider.update(state.renderedUri, formatInvalidOverrides(parsed.error));
			return;
		}

		// No execution context picked yet is not a reason to withhold a render —
		// Jinja renders undefined variables per its normal semantics server-side, so
		// render eagerly with whatever overrides are present (#173).
		const vars = mergeVars(state.mergedVars, parsed.vars ?? {});

		let freshSession: Awaited<ReturnType<typeof SessionManager.getSessionForOrg>>;
		try {
			freshSession = await SessionManager.getSessionForOrg(state.orgId);
		} catch (e) {
			if (isLive())
				JinjaRenderedContentProvider.update(
					state.renderedUri,
					formatRenderedError(`Session error: ${errMsg(e)}`),
				);
			return;
		}
		const freshDeps = createGraphqlDeps(freshSession);

		const editor = vscode.window.visibleTextEditors.find(
			e => e.document.uri.toString() === state.templateUri.toString(),
		);
		const templateText =
			editor && !editor.selection.isEmpty
				? editor.document.getText(editor.selection)
				: (editor?.document.getText() ??
					(await vscode.workspace.openTextDocument(state.templateUri)).getText());

		try {
			const outcome = await evaluateRenderJinja(freshDeps, state.orgId, templateText, vars);
			if (!isLive()) return;
			if (!outcome.ok) {
				JinjaRenderedContentProvider.update(
					state.renderedUri,
					formatRenderedError(`Jinja error: ${outcome.jinjaError}`),
				);
			} else {
				JinjaRenderedContentProvider.update(
					state.renderedUri,
					formatRenderedSuccess(outcome.value, outcome.hasControlCharacter ?? false),
				);
			}
		} catch (e) {
			if (isLive()) JinjaRenderedContentProvider.update(state.renderedUri, formatRenderedError(errMsg(e)));
		}
	}

	private scheduleRender(state: InternalState): void {
		if (state.debounceTimer) clearTimeout(state.debounceTimer);
		state.debounceTimer = setTimeout(() => void this.doRender(state), RENDER_DEBOUNCE_MS);
	}

	private async revealPanes(state: InternalState): Promise<void> {
		const templateDoc = await vscode.workspace.openTextDocument(state.templateUri);
		await vscode.window.showTextDocument(templateDoc, {
			viewColumn: findOpenTabColumn(state.templateUri) ?? vscode.ViewColumn.Active,
			preview: false,
		});

		// Vars/overrides pane: reveal its tab if a window reload left it open
		// (session map is in-memory only), otherwise open it beside the template.
		const overridesDoc = await vscode.workspace.openTextDocument(state.overridesUri);
		const overridesEditor = await vscode.window.showTextDocument(overridesDoc, {
			viewColumn: findOpenTabColumn(state.overridesUri) ?? vscode.ViewColumn.Beside,
			preview: false,
		});
		state.overridesClosed = false;

		// Rendered pane: same reveal-if-open check; otherwise stack it directly
		// below the vars pane (top-right / bottom-right) instead of opening a
		// third side-by-side column.
		const renderedDoc = await vscode.workspace.openTextDocument(state.renderedUri);
		await vscode.languages.setTextDocumentLanguage(renderedDoc, 'jsonc');
		const existingRenderedColumn = findOpenTabColumn(state.renderedUri);
		if (existingRenderedColumn !== undefined) {
			await vscode.window.showTextDocument(renderedDoc, { viewColumn: existingRenderedColumn, preview: false });
		} else {
			await vscode.commands.executeCommand('workbench.action.splitEditorDown');
			await vscode.window.showTextDocument(renderedDoc, { viewColumn: vscode.ViewColumn.Active, preview: false });
		}
		state.renderedClosed = false;

		// Refocus the vars pane last so the user lands ready to type overrides.
		await vscode.window.showTextDocument(overridesDoc, { viewColumn: overridesEditor.viewColumn, preview: false });
		state.overridesClosed = false;
	}

	async createOrShow(templateUri: vscode.Uri, context: vscode.ExtensionContext): Promise<InternalState> {
		const key = templateUri.toString();
		const existing = this.sessions.get(key);
		if (existing) {
			await this.revealPanes(existing);
			return existing;
		}

		const link = LinkManager.getTemplateLink(templateUri);
		const org = orgForTemplateLink(link);
		const templateId = link.template.id;
		const templateName = link.template.name ?? templateId;

		const overridesUri = await ensureOverridesFile(context, templateId, templateName);
		const renderedUri = JinjaRenderedContentProvider.uriFor(templateId, templateName);

		const state: InternalState = {
			templateUri,
			overridesUri,
			renderedUri,
			orgId: org.id,
			templateId,
			mergedVars: undefined,
			disposables: [],
			overridesClosed: false,
			renderedClosed: false,
		};

		await this.revealPanes(state);

		this.sessions.set(key, state);

		state.disposables.push(
			vscode.workspace.onDidChangeTextDocument(e => {
				const changedUri = e.document.uri.toString();
				if (changedUri === templateUri.toString() || changedUri === overridesUri.toString()) {
					this.scheduleRender(state);
				}
			}),
			vscode.window.onDidChangeTextEditorSelection(e => {
				if (e.textEditor.document.uri.toString() === templateUri.toString()) this.scheduleRender(state);
			}),
		);

		const remembered = getLastContext(context, templateId);
		if (remembered) {
			try {
				const renderOrgId = remembered.orgId || org.id;
				const rememberedSession = await SessionManager.getSessionForOrg(renderOrgId);
				state.mergedVars = await mergeExecutionContext(
					createGraphqlDeps(rememberedSession),
					remembered.executionId,
				);
				state.orgId = renderOrgId;
				await this.doRender(state);
			} catch (e) {
				JinjaRenderedContentProvider.update(
					renderedUri,
					formatRenderedError(`Could not load remembered context: ${errMsg(e)}`),
				);
			}
		} else {
			// No remembered context — still render immediately with empty/override-only
			// vars instead of leaving the panel on a static placeholder until the first
			// edit or context pick (#173).
			await this.doRender(state);
		}

		return state;
	}

	/**
	 * Maps any of a session's three pane uris (template, vars/overrides,
	 * rendered) back to its template uri, so "Pick Jinja Preview Context" works
	 * from whichever pane currently has focus, not just the template's own tab.
	 * Returns undefined if candidateUri isn't part of any live session (e.g. a
	 * stale pane tab left open from before a window reload).
	 */
	resolveTemplateUri(candidateUri: vscode.Uri): vscode.Uri | undefined {
		const candidateKey = candidateUri.toString();
		for (const state of this.sessions.values()) {
			if (
				state.templateUri.toString() === candidateKey ||
				state.overridesUri.toString() === candidateKey ||
				state.renderedUri.toString() === candidateKey
			) {
				return state.templateUri;
			}
		}
		return undefined;
	}

	async pickContext(templateUri: vscode.Uri, context: vscode.ExtensionContext): Promise<void> {
		const state = await this.createOrShow(templateUri, context);
		const link = LinkManager.getTemplateLink(templateUri);
		const org = orgForTemplateLink(link);

		let entry;
		try {
			entry = await pickJinjaExecutionContext({
				orgItems: buildOrgItems(org.id),
				initialOrgId: org.id,
				depsForOrg: async selectedOrgId =>
					createGraphqlDeps(await SessionManager.getSessionForOrg(selectedOrgId)),
			});
		} catch (e) {
			log.notifyError('Failed to pick Jinja preview context:', e);
			return;
		}
		if (!entry) return;

		saveLastContext(context, state.templateId, entry);
		try {
			const renderOrgId = entry.orgId || org.id;
			const contextSession = await SessionManager.getSessionForOrg(renderOrgId);
			state.mergedVars = await mergeExecutionContext(createGraphqlDeps(contextSession), entry.executionId);
			state.orgId = renderOrgId;
			await this.doRender(state);
		} catch (e) {
			log.notifyError('Failed to load Jinja preview context:', e);
		}
	}

	dispose(): void {
		this.closeListener?.dispose();
		this.closeListener = undefined;
		for (const key of [...this.sessions.keys()]) this.disposeSession(key);
	}

	async _renderForTesting(templateUri: vscode.Uri): Promise<void> {
		const state = this.sessions.get(templateUri.toString());
		if (state) await this.doRender(state);
	}

	_setMergedVarsForTesting(templateUri: vscode.Uri, vars: Record<string, unknown>): void {
		const state = this.sessions.get(templateUri.toString());
		if (state) state.mergedVars = vars;
	}

	_resetForTesting(): void {
		for (const key of [...this.sessions.keys()]) this.disposeSession(key);
	}
})();
