import type { SyncOnSaveChangeEvent } from '@events';
import { context, extPrefix } from '@global';
import vscode from 'vscode';
import { LinkManager } from './LinkManager';

export const SyncOnSaveManager = new (class _ implements vscode.Disposable {
	public globalEnabled = false;
	readonly stateKey = 'RewstSyncOnSaveManager';

	private readonly syncOnSaveChangedEmitter = new vscode.EventEmitter<SyncOnSaveChangeEvent>();
	readonly onSyncOnSave = this.syncOnSaveChangedEmitter.event;

	private disposables: vscode.Disposable[] = [];

	async init(): Promise<_> {
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('rewst-buddy.enableSyncOnSave')) {
					this.handleConfigChange();
				}
			}),
			LinkManager.onLinksSaved(() => {
				this.cleanupExclusions();
			}),
		);

		await this.handleConfigChange();
		this.updateContextKey();
		return this;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.syncOnSaveChangedEmitter.dispose();
	}

	public isUriSynced(uri: vscode.Uri): boolean {
		if (!this.globalEnabled) return false;
		return this._isUriSynced(uri);
	}

	private _isUriSynced(uri: vscode.Uri): boolean {
		if (!LinkManager.isLinked(uri)) return false;
		return !this.getExclusions().includes(uri.toString());
	}

	private async handleConfigChange(): Promise<void> {
		const config = vscode.workspace.getConfiguration(extPrefix);
		this.globalEnabled = config.get<boolean>('enableSyncOnSave', false);
	}

	private getExclusions() {
		return context.globalState.get<string[]>(this.stateKey, []);
	}

	private updateContextKey(): void {
		const exclusions = this.getExclusions();
		const pathObject: Record<string, boolean> = {};
		for (const uriString of exclusions) {
			pathObject[vscode.Uri.parse(uriString).fsPath] = true;
		}
		vscode.commands.executeCommand('setContext', `${extPrefix}.syncExclusions`, pathObject);
	}

	private cleanupExclusions(): void {
		const exclusions = this.getExclusions();
		const linkedUris = new Set(LinkManager.getAllUriStrings());
		const validExclusions = exclusions.filter(uri => linkedUris.has(uri));

		if (validExclusions.length !== exclusions.length) {
			this.save(validExclusions);
		}
	}

	public async addExclusion(uri: vscode.Uri | string): Promise<void> {
		const exclusions = new Set(this.getExclusions());
		exclusions.add(uri.toString());
		await this.save(Array.from(exclusions.values()));
	}

	public async removeExclusion(uri: vscode.Uri | string): Promise<boolean> {
		const exclusions = new Set(this.getExclusions());
		const removed = exclusions.delete(uri.toString());
		await this.save(Array.from(exclusions.values()));
		return removed;
	}

	private async save(exclusions: string[]): Promise<void> {
		await context.globalState.update(this.stateKey, exclusions);
		this.syncOnSaveChangedEmitter.fire({
			type: 'saved',
		});
		this.updateContextKey();
	}
})();
