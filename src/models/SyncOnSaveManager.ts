import type { SyncOnSaveChangeEvent } from '@events';
import { context, extPrefix } from '@global';
import { log } from '@utils';
import vscode from 'vscode';
import { LinkManager } from './LinkManager';

export const SyncOnSaveManager = new (class _ implements vscode.Disposable {
	public syncByDefault = false;
	readonly inclusionsKey = 'RewstSyncInclusions';
	readonly exclusionsKey = 'RewstSyncExclusions';

	private readonly syncOnSaveChangedEmitter = new vscode.EventEmitter<SyncOnSaveChangeEvent>();
	readonly onSyncOnSave = this.syncOnSaveChangedEmitter.event;

	private disposables: vscode.Disposable[] = [];

	// Cached sets for O(1) lookups (loaded from globalState on init)
	private inclusions = new Set<string>();
	private exclusions = new Set<string>();

	init(): _ {
		// Load cached sets from globalState
		this.inclusions = new Set(context.globalState.get<string[]>(this.inclusionsKey, []));
		this.exclusions = new Set(context.globalState.get<string[]>(this.exclusionsKey, []));

		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('rewst-buddy.syncOnSaveByDefault')) {
					this.handleConfigChange();
				}
			}),
			LinkManager.onLinksSaved(() => {
				this.cleanupInclusions();
				this.cleanupExclusions();
			}),
		);

		this.handleConfigChange();
		return this;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.syncOnSaveChangedEmitter.dispose();
		this.save();
	}

	/**
	 * Reset all state for testing purposes.
	 * This clears all inclusions/exclusions without persisting.
	 */
	_resetForTesting(): void {
		this.inclusions.clear();
		this.exclusions.clear();
		this.syncByDefault = false;
	}

	public isUriSynced(uri: vscode.Uri): boolean {
		if (!LinkManager.isLinked(uri)) {
			log.trace('SyncOnSaveManager.isUriSynced: not linked', uri.fsPath);
			return false;
		}

		const uriString = uri.toString();
		let synced: boolean;
		if (this.syncByDefault) {
			// Exclusion mode: sync unless in exclusion list
			synced = !this.exclusions.has(uriString);
		} else {
			// Inclusion mode: don't sync unless in inclusion list
			synced = this.inclusions.has(uriString);
		}

		log.trace('SyncOnSaveManager.isUriSynced:', {
			uri: uri.fsPath,
			synced,
			mode: this.syncByDefault ? 'exclusion' : 'inclusion',
		});
		return synced;
	}

	private handleConfigChange(): void {
		const config = vscode.workspace.getConfiguration(extPrefix);
		const newValue = config.get<boolean>('syncOnSaveByDefault', false);
		log.debug('SyncOnSaveManager.handleConfigChange: syncByDefault', { old: this.syncByDefault, new: newValue });
		this.syncByDefault = newValue;
		this.fire();
	}

	// Inclusion methods
	public addInclusion(uri: vscode.Uri | string): void {
		const key = uri.toString();
		if (this.inclusions.has(key)) return; // Already exists
		log.trace('SyncOnSaveManager.addInclusion:', key);
		this.inclusions.add(key);
		this.fire();
	}

	public removeInclusion(uri: vscode.Uri | string): boolean {
		log.trace('SyncOnSaveManager.removeInclusion:', uri.toString());
		const removed = this.inclusions.delete(uri.toString());
		if (removed) this.fire();
		return removed;
	}

	private cleanupInclusions(): void {
		const linkedUris = new Set(LinkManager.getAllUriStrings());
		const originalSize = this.inclusions.size;

		for (const uri of this.inclusions) {
			if (!linkedUris.has(uri)) {
				this.inclusions.delete(uri);
			}
		}

		if (this.inclusions.size !== originalSize) {
			this.fire();
		}
	}

	// Exclusion methods
	public addExclusion(uri: vscode.Uri | string): void {
		const key = uri.toString();
		if (this.exclusions.has(key)) return; // Already exists
		log.trace('SyncOnSaveManager.addExclusion:', key);
		this.exclusions.add(key);
		this.fire();
	}

	public removeExclusion(uri: vscode.Uri | string): boolean {
		log.trace('SyncOnSaveManager.removeExclusion:', uri.toString());
		const removed = this.exclusions.delete(uri.toString());
		if (removed) this.fire();
		return removed;
	}

	private cleanupExclusions(): void {
		const linkedUris = new Set(LinkManager.getAllUriStrings());
		const originalSize = this.exclusions.size;

		for (const uri of this.exclusions) {
			if (!linkedUris.has(uri)) {
				this.exclusions.delete(uri);
			}
		}

		if (this.exclusions.size !== originalSize) {
			this.fire();
		}
	}

	private fire(): void {
		this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
		this.save();
	}

	private save(): void {
		context.globalState.update(this.exclusionsKey, Array.from(this.exclusions));
		context.globalState.update(this.inclusionsKey, Array.from(this.inclusions));
	}

	// Abstracted methods for commands
	public enableSync(uri: vscode.Uri): void {
		log.debug('SyncOnSaveManager.enableSync:', uri.fsPath);
		const uriString = uri.toString();

		// Update both sets in memory
		this.exclusions.delete(uriString);
		this.inclusions.add(uriString);

		this.fire();
	}

	public disableSync(uri: vscode.Uri): void {
		log.debug('SyncOnSaveManager.disableSync:', uri.fsPath);
		const uriString = uri.toString();

		// Update both sets in memory
		this.exclusions.add(uriString);
		this.inclusions.delete(uriString);

		this.fire();
	}
})();
