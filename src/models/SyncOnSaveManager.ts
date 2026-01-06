import type { SyncOnSaveChangeEvent } from '@events';
import { context, extPrefix } from '@global';
import vscode from 'vscode';
import { LinkManager } from './LinkManager';

export const SyncOnSaveManager = new (class _ implements vscode.Disposable {
	public syncByDefault = false;
	readonly inclusionsKey = 'RewstSyncInclusions';
	readonly exclusionsKey = 'RewstSyncExclusions';

	private readonly syncOnSaveChangedEmitter = new vscode.EventEmitter<SyncOnSaveChangeEvent>();
	readonly onSyncOnSave = this.syncOnSaveChangedEmitter.event;

	private disposables: vscode.Disposable[] = [];

	async init(): Promise<_> {
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
		if (!LinkManager.isLinked(uri)) return false;

		if (this.syncByDefault) {
			// Exclusion mode: sync unless in exclusion list
			return !this.getExclusions().includes(uri.toString());
		} else {
			// Inclusion mode: don't sync unless in inclusion list
			return this.getInclusions().includes(uri.toString());
		}
	}

	private async handleConfigChange(): Promise<void> {
		const config = vscode.workspace.getConfiguration(extPrefix);
		this.syncByDefault = config.get<boolean>('syncOnSaveByDefault', false);
		this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}

	// Inclusion methods
	private getInclusions(): string[] {
		return context.globalState.get<string[]>(this.inclusionsKey, []);
	}

	public async addInclusion(uri: vscode.Uri | string, fire = false): Promise<void> {
		const inclusions = new Set(this.getInclusions());
		inclusions.add(uri.toString());
		await this.saveInclusions(Array.from(inclusions.values()), fire);
	}

	public async removeInclusion(uri: vscode.Uri | string, fire = false): Promise<boolean> {
		const inclusions = new Set(this.getInclusions());
		const removed = inclusions.delete(uri.toString());
		if (removed) {
			await this.saveInclusions(Array.from(inclusions.values()), fire);
		}
		return removed;
	}

	private cleanupInclusions(): void {
		const inclusions = this.getInclusions();
		const linkedUris = new Set(LinkManager.getAllUriStrings());
		const validInclusions = inclusions.filter(uri => linkedUris.has(uri));

		if (validInclusions.length !== inclusions.length) {
			this.saveInclusions(validInclusions);
		}
	}

	// Exclusion methods
	private getExclusions(): string[] {
		return context.globalState.get<string[]>(this.exclusionsKey, []);
	}

	public async addExclusion(uri: vscode.Uri | string, fire = false): Promise<void> {
		const exclusions = new Set(this.getExclusions());
		exclusions.add(uri.toString());
		await this.saveExclusions(Array.from(exclusions.values()), fire);
	}

	public async removeExclusion(uri: vscode.Uri | string, fire = false): Promise<boolean> {
		const exclusions = new Set(this.getExclusions());
		const removed = exclusions.delete(uri.toString());
		if (removed) {
			await this.saveExclusions(Array.from(exclusions.values()), fire);
		}
		return removed;
	}

	private cleanupExclusions(): void {
		const exclusions = this.getExclusions();
		const linkedUris = new Set(LinkManager.getAllUriStrings());
		const validExclusions = exclusions.filter(uri => linkedUris.has(uri));

		if (validExclusions.length !== exclusions.length) {
			this.saveExclusions(validExclusions);
		}
	}

	private async saveExclusions(exclusions: string[], fire = false): Promise<void> {
		await context.globalState.update(this.exclusionsKey, exclusions);
		if (fire) this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}

	private async saveInclusions(inclusions: string[], fire = false): Promise<void> {
		await context.globalState.update(this.inclusionsKey, inclusions);
		if (fire) this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}

	// Abstracted methods for commands
	public async enableSync(uri: vscode.Uri): Promise<void> {
		await this.removeExclusion(uri, false);
		await this.addInclusion(uri, false);
		this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}

	public async disableSync(uri: vscode.Uri): Promise<void> {
		await this.addExclusion(uri, false);
		await this.removeInclusion(uri, false);
		this.syncOnSaveChangedEmitter.fire({ type: 'saved' });
	}
})();
