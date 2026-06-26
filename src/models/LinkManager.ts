import type { LinksSavedEvent } from '@events';
import { context, extPrefix } from '@global';
import { getHash, isDescendant, log } from '@utils';
import vscode, { Uri } from 'vscode';
import { SyncOnSaveManager } from './SyncOnSaveManager';
import { FolderLink, Link, LinkType, Org, TemplateLink } from './types';

const PERSIST_DEBOUNCE_MS = 300;
const PRUNE_STAT_CHUNK_SIZE = 50;

export const LinkManager = new (class _ implements vscode.Disposable {
	readonly stateKey = 'RewstTemplateLinks';
	linkMap = new Map<string, Link>();
	private templateIdIndex = new Map<string, TemplateLink[]>();
	private orgIdIndex = new Map<string, Set<string>>();
	loaded = false;

	private readonly linksSavedEmitter = new vscode.EventEmitter<LinksSavedEvent>();
	readonly onLinksSaved = this.linksSavedEmitter.event;

	private disposables: vscode.Disposable[] = [];

	private batchMode = false;
	private persistTimer: NodeJS.Timeout | undefined;
	private persistInFlight: Promise<void> | undefined;

	init(): _ {
		this.disposables.push(vscode.workspace.onDidRenameFiles(e => this.handleRename(e)));
		this.disposables.push(vscode.workspace.onDidDeleteFiles(e => this.handleDelete(e)));
		return this;
	}

	dispose(): void {
		// Issue any pending persist immediately; VS Code flushes queued
		// globalState writes on shutdown, but a debounce timer would be lost.
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
			this.save();
		}
		this.disposables.forEach(d => d.dispose());
		this.linksSavedEmitter.dispose();
	}

	/**
	 * Reset all state for testing purposes.
	 * This clears all links and indexes without persisting.
	 */
	_resetForTesting(): void {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
		}
		this.persistInFlight = undefined;
		this.linkMap.clear();
		this.templateIdIndex.clear();
		this.orgIdIndex.clear();
		this.loaded = true;
		this.batchMode = false;
	}

	_pruneForTesting(): Promise<void> {
		return this.pruneStaleLinks();
	}

	_handleDeleteForTesting(e: vscode.FileDeleteEvent): void {
		return this.handleDelete(e);
	}

	private async handleRename(e: vscode.FileRenameEvent): Promise<void> {
		log.trace('LinkManager.handleRename: processing', { fileCount: e.files.length });

		this.beginBatch();
		try {
			for (const file of e.files) {
				const stat = await vscode.workspace.fs.stat(file.newUri);
				const isFile = (stat.type & vscode.FileType.File) !== 0;
				const isDir = (stat.type & vscode.FileType.Directory) !== 0;

				if (!isFile && !isDir) continue;

				if (isDir) {
					log.trace('LinkManager.handleRename: processing directory', file.newUri.fsPath);
					const uris = this.getAllUriStrings();
					const oldPrefix = file.oldUri.toString();
					const newPrefix = file.newUri.toString();

					for (const child of uris) {
						if (isDescendant(file.oldUri, vscode.Uri.parse(child))) {
							const newUri = newPrefix + child.slice(oldPrefix.length);
							await this.moveLink(child, newUri);
						}
					}
				} else if (isFile) {
					log.trace('LinkManager.handleRename: processing file', file.newUri.fsPath);
					await this.moveLink(file.oldUri.toString(), file.newUri.toString());
				}
			}
		} catch (error) {
			log.error('LinkManager.handleRename: failed', error);
		} finally {
			await this.endBatch();
		}
	}

	private handleDelete(e: vscode.FileDeleteEvent): void {
		log.trace('LinkManager.handleDelete: processing', { fileCount: e.files.length });
		this.beginBatch();
		try {
			for (const uri of e.files) {
				const uriString = uri.toString();
				if (this.linkMap.has(uriString)) {
					this.removeLink(uriString);
				} else {
					const toRemove = [...this.linkMap.keys()].filter(key => isDescendant(uri, vscode.Uri.parse(key)));
					for (const key of toRemove) this.removeLink(key);
				}
			}
		} catch (error) {
			log.error('LinkManager.handleDelete: failed', error);
		} finally {
			this.endBatch().catch(err => log.error('LinkManager.handleDelete: persist failed', err));
		}
	}

	private async pruneStaleLinks(): Promise<void> {
		const entries = Array.from(this.linkMap.keys());

		const stale: string[] = [];
		for (let i = 0; i < entries.length; i += PRUNE_STAT_CHUNK_SIZE) {
			const chunk = entries.slice(i, i + PRUNE_STAT_CHUNK_SIZE);
			const results = await Promise.allSettled(
				chunk.map(async uri => {
					try {
						await vscode.workspace.fs.stat(vscode.Uri.parse(uri));
						return true;
					} catch (error) {
						if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
							return false;
						}
						return true; // Keep link on ambiguous errors (permissions, network)
					}
				}),
			);

			for (let j = 0; j < chunk.length; j++) {
				const result = results[j];
				if (result.status === 'fulfilled' && result.value === false) {
					stale.push(chunk[j]);
				}
			}
		}

		if (stale.length === 0) return;

		log.info('LinkManager.pruneStaleLinks: removing stale links', { count: stale.length });
		this.beginBatch();
		try {
			for (const uriString of stale) {
				if (this.linkMap.has(uriString)) {
					log.debug('LinkManager.pruneStaleLinks: removed', uriString);
					this.removeLink(uriString);
				}
			}
		} finally {
			await this.endBatch();
		}
	}

	clearTemplateLinks(): _ {
		log.debug('LinkManager.clearTemplateLinks: clearing all template links');
		let cleared = 0;
		for (const [uriString, link] of this.linkMap) {
			if (link.type === 'Template') {
				this.linkMap.delete(uriString);
				this.removeFromOrgIndex(link.org.id, uriString);
				cleared++;
			}
		}
		this.templateIdIndex.clear();
		log.trace('LinkManager.clearTemplateLinks: cleared', cleared);
		this.fire();
		return this;
	}

	removeLink(uriString: string): _ {
		log.trace('LinkManager.removeLink:', uriString);
		const link = this.linkMap.get(uriString);
		if (link?.type === 'Template') {
			this.removeFromTemplateIndex(link as TemplateLink);
		}
		if (link) {
			// Key off the parameter: moveLink mutates link.uriString before calling here
			this.removeFromOrgIndex(link.org.id, uriString);
		}
		this.linkMap.delete(uriString);
		this.fire();
		return this;
	}

	addLink(link: Link): _ {
		log.trace('LinkManager.addLink:', link);
		// Re-linking the same uri to a different template/org must drop the previous
		// link's secondary-index entries first; otherwise a stale templateIdIndex /
		// orgIdIndex entry survives and reverse lookups return the old file (#90).
		const previous = this.linkMap.get(link.uriString);
		if (previous && previous !== link) {
			if (previous.type === 'Template') this.removeFromTemplateIndex(previous as TemplateLink);
			this.removeFromOrgIndex(previous.org.id, link.uriString);
		}
		this.linkMap.set(link.uriString, link);
		if (link.type === 'Template') {
			this.addToTemplateIndex(link as TemplateLink);
		}
		this.addToOrgIndex(link);
		this.fire();
		return this;
	}

	private addToOrgIndex(link: Link): void {
		let uris = this.orgIdIndex.get(link.org.id);
		if (!uris) {
			uris = new Set();
			this.orgIdIndex.set(link.org.id, uris);
		}
		uris.add(link.uriString);
	}

	private removeFromOrgIndex(orgId: string, uriString: string): void {
		const uris = this.orgIdIndex.get(orgId);
		if (!uris) return;
		uris.delete(uriString);
		if (uris.size === 0) this.orgIdIndex.delete(orgId);
	}

	private addToTemplateIndex(link: TemplateLink): void {
		const existing = this.templateIdIndex.get(link.template.id) ?? [];
		const filtered = existing.filter(l => l.uriString !== link.uriString);
		filtered.push(link);
		this.templateIdIndex.set(link.template.id, filtered);
	}

	private removeFromTemplateIndex(link: TemplateLink): void {
		const existing = this.templateIdIndex.get(link.template.id);
		if (existing) {
			// Filter by identity: moveLink mutates link.uriString before removal,
			// so string comparison against the old key would miss the entry
			const filtered = existing.filter(l => l !== link);
			if (filtered.length === 0) {
				this.templateIdIndex.delete(link.template.id);
			} else {
				this.templateIdIndex.set(link.template.id, filtered);
			}
		}
	}

	async moveLink(oldUriString: string, newUriString: string): Promise<_> {
		if (!this.batchMode) throw log.error('Can only move link after initiating batch mode');
		log.trace('LinkManager.moveLink: starting', { from: oldUriString, to: newUriString });

		const link = this.linkMap.get(oldUriString);
		if (link === undefined) {
			log.trace('LinkManager.moveLink: no link found at old location');
			return this;
		}

		link.uriString = newUriString;

		// Move inclusion status if present
		const wasIncluded = SyncOnSaveManager.removeInclusion(oldUriString);
		if (wasIncluded) SyncOnSaveManager.addInclusion(newUriString);

		// Move exclusion status if present
		const wasExcluded = SyncOnSaveManager.removeExclusion(oldUriString);
		if (wasExcluded) SyncOnSaveManager.addExclusion(newUriString);

		this.removeLink(oldUriString).addLink(link);

		log.trace('LinkManager.moveLink: completed', { type: link.type });

		this.fire();
		return this;
	}

	beginBatch(): _ {
		log.trace('LinkManager.beginBatch: entering batch mode');
		this.batchMode = true;
		return this;
	}

	async endBatch(): Promise<_> {
		log.trace('LinkManager.endBatch: exiting batch mode');
		this.batchMode = false;
		this.fire();
		await this.flush();
		return this;
	}

	fire() {
		if (this.batchMode) return;

		const links = Array.from(this.linkMap.values());
		this.linksSavedEmitter.fire({
			links: links,
		});

		this.schedulePersist();
	}

	private schedulePersist(): void {
		if (this.persistTimer) clearTimeout(this.persistTimer);
		this.persistTimer = setTimeout(() => {
			this.persistTimer = undefined;
			this.flush().catch(err => log.error('LinkManager: debounced persist failed', err));
		}, PERSIST_DEBOUNCE_MS);
	}

	/**
	 * Persist current state immediately, cancelling any pending debounce.
	 * Concurrent calls are serialized behind the in-flight persist.
	 */
	async flush(): Promise<void> {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
		}

		const previous = this.persistInFlight ?? Promise.resolve();
		const current = previous
			.catch(() => undefined)
			.then(async () => {
				await this.updateLinksContext(Array.from(this.linkMap.values()));
				await this.save();
			});
		this.persistInFlight = current;
		try {
			await current;
		} finally {
			if (this.persistInFlight === current) this.persistInFlight = undefined;
		}
	}

	async save(): Promise<_> {
		log.trace('LinkManager.save');
		const links: Link[] = Array.from(this.linkMap.values()).map(link => {
			if (link.type === 'Template') {
				const templateLink = link as TemplateLink;
				return {
					...templateLink,
					template: { ...templateLink.template, body: undefined },
				};
			}
			return link;
		});
		await context.globalState.update(this.stateKey, links);
		return this;
	}

	private async updateLinksContext(links: Link[]) {
		const folders: Record<string, boolean> = {};
		const templates: Record<string, boolean> = {};
		for (const link of links) {
			if (link.type == 'Folder') {
				folders[vscode.Uri.parse(link.uriString).fsPath] = true;
			} else if (link.type == 'Template') {
				templates[vscode.Uri.parse(link.uriString).fsPath] = true;
			}
		}
		await vscode.commands.executeCommand('setContext', `${extPrefix}.linkedTemplates`, templates);
		await vscode.commands.executeCommand('setContext', `${extPrefix}.linkedFolders`, folders);
	}

	loadLinks(): _ {
		this.loaded = true;

		log.trace('LinkManager.loadLinks: loading');
		const links = context.globalState.get<Link[]>(this.stateKey) ?? [];
		log.debug('LinkManager.loadLinks: found links', links.length);
		this.linkMap.clear();
		this.templateIdIndex.clear();
		this.orgIdIndex.clear();

		this.beginBatch();

		for (const link of links) {
			// Migrate old TemplateLinks: ensure bodyHash exists, clear template.body
			if (link.type === 'Template') {
				const templateLink = link as TemplateLink;
				const body = (templateLink.template as any).body;
				if (body !== undefined && !templateLink.bodyHash) {
					templateLink.bodyHash = getHash(body);
					log.trace('LinkManager.loadLinks: migrated old link with bodyHash', templateLink.template.id);
				}
				(templateLink.template as any).body = undefined;
			}
			this.addLink(link);
		}

		this.endBatch().catch(err => log.error('LinkManager.loadLinks: persist failed', err));

		this.pruneStaleLinks().catch(err => log.error('LinkManager.pruneStaleLinks: failed', err));

		log.trace('LinkManager.loadLinks: completed');
		return this;
	}

	loadIfNotAlready(): _ {
		if (!this.loaded) this.loadLinks();
		return this;
	}

	isLinked(uri: vscode.Uri): boolean {
		this.loadIfNotAlready();
		return this.linkMap.has(uri.toString());
	}

	getTemplateLinkFromId(templateId: string): TemplateLink[] {
		this.loadIfNotAlready();
		return this.templateIdIndex.get(templateId) ?? [];
	}

	private getLink(uri: vscode.Uri, type: LinkType): Link {
		this.loadIfNotAlready();
		const link = this.linkMap.get(uri.toString());

		if (link === undefined) throw log.error(`Could not find link for uri ${uri.toString()}`);
		if (link.type !== type) throw log.error(`Incorrect type retrieved`, link.type, type);

		return link;
	}

	getTemplateLink(uri: vscode.Uri): TemplateLink {
		this.loadIfNotAlready();
		return this.getLink(uri, 'Template') as TemplateLink;
	}

	getFolderLink(uri: Uri): FolderLink {
		this.loadIfNotAlready();
		return this.getLink(uri, 'Folder') as FolderLink;
	}

	getOrgLinks(org: Org): Link[] {
		this.loadIfNotAlready();
		const uris = this.orgIdIndex.get(org.id);
		if (!uris) return [];
		const links: Link[] = [];
		for (const uri of uris) {
			const link = this.linkMap.get(uri);
			if (link) links.push(link);
		}
		return links;
	}

	getOrgTemplateLinks(org: Org): TemplateLink[] {
		this.loadIfNotAlready();
		const links = this.getOrgLinks(org);
		return links.filter(l => l.type == 'Template') as TemplateLink[];
	}

	getAllUriStrings(): string[] {
		this.loadIfNotAlready();
		return Array.from(this.linkMap.keys());
	}

	getAllUris(): vscode.Uri[] {
		this.loadIfNotAlready();
		return Array.from(this.linkMap.keys()).map(uri => vscode.Uri.parse(uri));
	}

	getAllTemplateLinks(): TemplateLink[] {
		this.loadIfNotAlready();
		return Array.from(this.linkMap.values()).filter((l): l is TemplateLink => l.type === 'Template');
	}

	getFolderLinks(): FolderLink[] {
		this.loadIfNotAlready();

		const links = Array.from(this.linkMap.values());

		return links.filter(l => l.type === 'Folder') as FolderLink[];
	}
})();
