import type { LinksSavedEvent } from '@events';
import { context, extPrefix } from '@global';
import { isDescendant, log } from '@utils';
import vscode, { Uri } from 'vscode';
import { SyncOnSaveManager } from './SyncOnSaveManager';
import { FolderLink, Link, LinkType, Org, TemplateLink } from './types';

export const LinkManager = new (class _ implements vscode.Disposable {
	readonly stateKey = 'RewstTemplateLinks';
	linkMap = new Map<string, Link>();
	loaded = false;

	private readonly linksSavedEmitter = new vscode.EventEmitter<LinksSavedEvent>();
	readonly onLinksSaved = this.linksSavedEmitter.event;

	private disposables: vscode.Disposable[] = [];

	private batchMode = false;

	init(): _ {
		this.disposables.push(vscode.workspace.onDidRenameFiles(e => this.handleRename(e)));
		return this;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.linksSavedEmitter.dispose();
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
			this.endBatch();
		}
	}

	clearTemplateLinks(): _ {
		log.debug('LinkManager.clearTemplateLinks: clearing all template links');
		let cleared = 0;
		for (const link of this.linkMap.values()) {
			if (link.type === 'Template') {
				this.linkMap.delete(link.uriString);
				cleared++;
			}
		}
		log.trace('LinkManager.clearTemplateLinks: cleared', cleared);
		this.fire();
		return this;
	}

	removeLink(uriString: string): _ {
		log.trace('LinkManager.removeLink:', uriString);
		this.linkMap.delete(uriString);
		this.fire();
		return this;
	}

	addLink(link: Link): _ {
		log.trace('LinkManager.addLink:', link);
		this.linkMap.set(link.uriString, link);
		this.fire();
		return this;
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
		return this;
	}

	fire() {
		if (this.batchMode) return;

		const links = Array.from(this.linkMap.values());
		this.linksSavedEmitter.fire({
			links: links,
		});

		this.updateLinksContext(links);
		this.save();
	}

	async save(): Promise<_> {
		log.trace('LinkManager.save');
		const links: Link[] = Array.from(this.linkMap.values());
		context.globalState.update(this.stateKey, links);
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

		this.beginBatch();

		for (const link of links) {
			this.addLink(link);
		}

		this.endBatch();

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

		return Array.from(this.linkMap.values()).filter(l => {
			if (l.type === 'Folder') return false;
			if ((l as TemplateLink).template.id.localeCompare(templateId) === 0) {
				return true;
			}
		}) as TemplateLink[];
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
		const links = Array.from(this.linkMap.values());
		return links.filter(link => link.org.id === org.id);
	}

	getOrgTemplateLinks(org: Org): TemplateLink[] {
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

	getFolderLinks(): FolderLink[] {
		this.loadIfNotAlready();

		const links = Array.from(this.linkMap.values());

		return links.filter(l => l.type === 'Folder') as FolderLink[];
	}
})();
