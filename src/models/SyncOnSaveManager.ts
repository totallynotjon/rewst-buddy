import type { SyncOnSaveChangeEvent } from '@events';
import { context, extPrefix } from '@global';
import vscode from 'vscode';
import { TemplateLinkManager } from './TemplateLinkManager';

export const SyncOnSaveManager = new (class _ implements vscode.Disposable {
	public globalEnabled = false;
	readonly stateKey = 'RewstSyncOnSaveManager';

	private readonly syncOnSaveChangedEmitter = new vscode.EventEmitter<SyncOnSaveChangeEvent>();
	readonly onSyncOnSave = this.syncOnSaveChangedEmitter.event;

	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('rewst-buddy.enableSyncOnSave')) {
					this.handleConfigChange();
				}
			}),
			TemplateLinkManager.onLinksSaved(() => {
				this.cleanupExclusions();
			}),
		);
		this.init();
	}

	async init(): Promise<void> {
		await this.handleConfigChange();
		this.updateContextKey();
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
		if (!TemplateLinkManager.isLinked(uri)) return false;
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
		const linkedUris = new Set(TemplateLinkManager.getAllUriStrings());
		const validExclusions = exclusions.filter(uri => linkedUris.has(uri));

		if (validExclusions.length !== exclusions.length) {
			this.save(validExclusions);
		}
	}

	public async addExclusion(uri: vscode.Uri): Promise<void> {
		const exclusions = new Set(this.getExclusions());
		exclusions.add(uri.toString());
		await this.save(Array.from(exclusions.values()));
	}

	public async removeExclusion(uri: vscode.Uri): Promise<void> {
		const exclusions = new Set(this.getExclusions());
		exclusions.delete(uri.toString());
		await this.save(Array.from(exclusions.values()));
	}

	private async save(exclusions: string[]): Promise<void> {
		await context.globalState.update(this.stateKey, exclusions);
		this.syncOnSaveChangedEmitter.fire({
			type: 'saved',
		});
		this.updateContextKey();
	}
})();
