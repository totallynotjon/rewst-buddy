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

	init(): _ {
		this.disposables.push(vscode.workspace.onDidRenameFiles(e => this.handleRename(e)));
		return this;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.linksSavedEmitter.dispose();
	}

	private async handleRename(e: vscode.FileRenameEvent): Promise<void> {
		try {
			for (const file of e.files) {
				const stat = await vscode.workspace.fs.stat(file.newUri);
				const isFile = (stat.type & vscode.FileType.File) !== 0;
				const isDir = (stat.type & vscode.FileType.Directory) !== 0;

				if (!isFile && !isDir) continue;

				if (isDir) {
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
					await this.moveLink(file.oldUri.toString(), file.newUri.toString());
				}
			}

			await this.save();
		} catch (error) {
			log.error('Failed to handle rename event', error);
		}
	}

	clearTemplateLinks(): _ {
		for (const link of this.linkMap.values()) {
			if (link.type === 'Template') {
				this.linkMap.delete(link.uriString);
			}
		}
		return this;
	}

	removeLink(uriString: string): _ {
		this.linkMap.delete(uriString);
		return this;
	}

	addLink(link: Link): _ {
		this.linkMap.set(link.uriString, link);
		return this;
	}

	async moveLink(oldUriString: string, newUriString: string): Promise<_> {
		const link = this.linkMap.get(oldUriString);
		if (link === undefined) return this;

		link.uriString = newUriString;

		const excluded = await SyncOnSaveManager.removeExclusion(oldUriString);
		if (excluded) await SyncOnSaveManager.addExclusion(newUriString);

		this.removeLink(oldUriString).addLink(link);

		log.trace(`Move processed for  (${oldUriString} => (${newUriString}) `);

		return this;
	}

	async save(): Promise<_> {
		const links: Link[] = Array.from(this.linkMap.values());
		await context.globalState.update(this.stateKey, links);
		this.updateLinksContext(links);
		this.linksSavedEmitter.fire({ links: links });
		return this;
	}

	private updateLinksContext(links: Link[]) {
		const folders: Record<string, boolean> = {};
		const templates: Record<string, boolean> = {};
		for (const link of links) {
			if (link.type == 'Folder') {
				folders[vscode.Uri.parse(link.uriString).fsPath] = true;
			} else if (link.type == 'Template') {
				templates[vscode.Uri.parse(link.uriString).fsPath] = true;
			}
		}
		vscode.commands.executeCommand('setContext', `${extPrefix}.linkedTemplates`, templates);
		vscode.commands.executeCommand('setContext', `${extPrefix}.linkedFolders`, folders);
	}

	loadLinks(): _ {
		const links = context.globalState.get<Link[]>(this.stateKey) ?? [];
		this.linkMap.clear();
		let migrated = false;

		for (const link of links) {
			// Handle missing type (pre-folder era)
			if (link.type === undefined) {
				link.type = 'Template';
				migrated = true;
			}

			// Handle legacy sessionProfile field
			if ((link as any).sessionProfile) {
				link.org = (link as any).sessionProfile.org;
				delete (link as any).sessionProfile;
				migrated = true;
			}

			this.addLink(link);
		}
		this.loaded = true;
		this.updateLinksContext(links);

		if (migrated) {
			this.save();
		}

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
