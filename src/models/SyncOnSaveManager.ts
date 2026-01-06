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

	async init(): Promise<_> {
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

		await this.handleConfigChange();
		return this;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.syncOnSaveChangedEmitter.dispose();
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
			synced = !this.exclusions.has(uriString); // O(1) lookup
		} else {
			// Inclusion mode: don't sync unless in inclusion list
			synced = this.inclusions.has(uriString); // O(1) lookup
		}

		log.trace('SyncOnSaveManager.isUriSynced:', {
			uri: uri.fsPath,
			synced,
			mode: this.syncByDefault ? 'exclusion' : 'inclusion',
		});
		return synced;
	}

	private async handleConfigChange(): Promise<void> {
		const config = vscode.workspace.getConfiguration(extPrefix);
		const newValue = config.get<boolean>('syncOnSaveByDefault', false);
		log.debug('SyncOnSaveManager.handleConfigChange: syncByDefault', { old: this.syncByDefault, new: newValue });
		this.syncByDefault = newValue;
		this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}

	// Inclusion methods
	public async addInclusion(uri: vscode.Uri | string, fire = false): Promise<void> {
		log.trace('SyncOnSaveManager.addInclusion:', uri.toString());
		this.inclusions.add(uri.toString());
		await this.saveInclusions(fire);
	}

	public async removeInclusion(uri: vscode.Uri | string, fire = false): Promise<boolean> {
		log.trace('SyncOnSaveManager.removeInclusion:', uri.toString());
		const removed = this.inclusions.delete(uri.toString());
		if (removed) {
			await this.saveInclusions(fire);
		}
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
			this.saveInclusions(); // Fire-and-forget
		}
	}

	// Exclusion methods
	public async addExclusion(uri: vscode.Uri | string, fire = false): Promise<void> {
		log.trace('SyncOnSaveManager.addExclusion:', uri.toString());
		this.exclusions.add(uri.toString());
		await this.saveExclusions(fire);
	}

	public async removeExclusion(uri: vscode.Uri | string, fire = false): Promise<boolean> {
		log.trace('SyncOnSaveManager.removeExclusion:', uri.toString());
		const removed = this.exclusions.delete(uri.toString());
		if (removed) {
			await this.saveExclusions(fire);
		}
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
			this.saveExclusions(); // Fire-and-forget
		}
	}

	private async saveExclusions(fire = false): Promise<void> {
		await context.globalState.update(this.exclusionsKey, Array.from(this.exclusions));
		if (fire) this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}

	private async saveInclusions(fire = false): Promise<void> {
		await context.globalState.update(this.inclusionsKey, Array.from(this.inclusions));
		if (fire) this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}

	// Abstracted methods for commands
	public async enableSync(uri: vscode.Uri): Promise<void> {
		log.debug('SyncOnSaveManager.enableSync:', uri.fsPath);
		const uriString = uri.toString();

		// Update both sets in memory first
		this.exclusions.delete(uriString);
		this.inclusions.add(uriString);

		// Parallel saves instead of sequential
		await Promise.all([this.saveExclusions(false), this.saveInclusions(false)]);

		this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}

	public async disableSync(uri: vscode.Uri): Promise<void> {
		log.debug('SyncOnSaveManager.disableSync:', uri.fsPath);
		const uriString = uri.toString();

		// Update both sets in memory first
		this.exclusions.add(uriString);
		this.inclusions.delete(uriString);

		// Parallel saves instead of sequential
		await Promise.all([this.saveExclusions(false), this.saveInclusions(false)]);

		this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}
})();
