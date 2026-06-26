import { context } from '@global';
import vscode from 'vscode';

/**
 * The user's current working scope: the set of orgs (and, optionally, workflows)
 * that Rewst tool calls are allowed to operate on right now. It is the ambient,
 * model-immutable blast-radius cap behind issue #87 — the org a tool targets is
 * resolved against this scope rather than trusted from the model's arguments, so
 * a confused or poisoned model cannot escape to another org by naming it.
 *
 * The scope is multi-valued (work spans several orgs/workflows when wanted) and
 * is set deliberately by the user (command palette / status bar) or requested by
 * the model behind a VS Code modal. It is separate from the persistent
 * `rewst-buddy.mcp.alwaysAllowedOrgs` setting: enforcement folds the two together
 * (see McpActions), but this state is the ephemeral, per-session selection.
 */

/** A snapshot of the working scope, emitted on every change. */
export interface WorkingScopeState {
	orgs: string[];
	workflows: string[];
}

function normalizeIds(ids: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		const trimmed = typeof id === 'string' ? id.trim() : '';
		if (trimmed.length === 0 || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

export const WorkingScopeManager = new (class _ implements vscode.Disposable {
	readonly stateKey = 'RewstWorkingScope';
	private orgs = new Set<string>();
	private workflows = new Set<string>();
	private loaded = false;

	private readonly changeEmitter = new vscode.EventEmitter<WorkingScopeState>();
	readonly onDidChangeScope = this.changeEmitter.event;

	private ensureLoaded(): void {
		if (this.loaded) return;
		const saved = context.globalState.get<WorkingScopeState>(this.stateKey);
		this.orgs = new Set(normalizeIds(saved?.orgs ?? []));
		this.workflows = new Set(normalizeIds(saved?.workflows ?? []));
		this.loaded = true;
	}

	getOrgs(): string[] {
		this.ensureLoaded();
		return [...this.orgs];
	}

	getWorkflows(): string[] {
		this.ensureLoaded();
		return [...this.workflows];
	}

	hasOrg(orgId: string): boolean {
		this.ensureLoaded();
		return this.orgs.has(orgId);
	}

	hasWorkflow(workflowId: string): boolean {
		this.ensureLoaded();
		return this.workflows.has(workflowId);
	}

	/** True when no orgs or workflows are pinned. */
	isEmpty(): boolean {
		this.ensureLoaded();
		return this.orgs.size === 0 && this.workflows.size === 0;
	}

	setOrgs(orgIds: readonly string[]): void {
		this.ensureLoaded();
		this.orgs = new Set(normalizeIds(orgIds));
		this.commit();
	}

	addOrgs(orgIds: readonly string[]): void {
		this.ensureLoaded();
		for (const id of normalizeIds(orgIds)) this.orgs.add(id);
		this.commit();
	}

	removeOrgs(orgIds: readonly string[]): void {
		this.ensureLoaded();
		for (const id of normalizeIds(orgIds)) this.orgs.delete(id);
		this.commit();
	}

	setWorkflows(workflowIds: readonly string[]): void {
		this.ensureLoaded();
		this.workflows = new Set(normalizeIds(workflowIds));
		this.commit();
	}

	addWorkflows(workflowIds: readonly string[]): void {
		this.ensureLoaded();
		for (const id of normalizeIds(workflowIds)) this.workflows.add(id);
		this.commit();
	}

	removeWorkflows(workflowIds: readonly string[]): void {
		this.ensureLoaded();
		for (const id of normalizeIds(workflowIds)) this.workflows.delete(id);
		this.commit();
	}

	clear(): void {
		this.ensureLoaded();
		this.orgs.clear();
		this.workflows.clear();
		this.commit();
	}

	snapshot(): WorkingScopeState {
		this.ensureLoaded();
		return { orgs: [...this.orgs], workflows: [...this.workflows] };
	}

	private commit(): void {
		const state = this.snapshot();
		// Fire-and-forget persistence: the user action returns immediately and the
		// write flushes in the background, matching the extension's other managers.
		void context.globalState.update(this.stateKey, state);
		this.changeEmitter.fire(state);
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}

	/** Resets in-memory state for tests without persisting. */
	_resetForTesting(): void {
		this.orgs.clear();
		this.workflows.clear();
		this.loaded = true;
	}

	/** Forces the next read to reload from the backing store. */
	_reloadForTesting(): void {
		this.loaded = false;
	}
})();
