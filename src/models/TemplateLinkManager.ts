import type { LinksSavedEvent } from '@events';
import { context, extPrefix } from '@global';
import { log } from '@utils';
import vscode from 'vscode';
import TemplateLink from './TemplateLink';

export const TemplateLinkManager = new (class TemplateLinkManager implements vscode.Disposable {
	readonly stateKey = 'RewstTemplateLinks';
	linkMap = new Map<string, TemplateLink>();
	loaded = false;

	private readonly linksSavedEmitter = new vscode.EventEmitter<LinksSavedEvent>();
	readonly onLinksSaved = this.linksSavedEmitter.event;

	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.disposables.push(
			vscode.workspace.onDidRenameFiles(e => this.handleRename(e)),
		);
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
						if (this.isDescendant(file.oldUri, vscode.Uri.parse(child))) {
							const newUri = newPrefix + child.slice(oldPrefix.length);
							try {
								this.moveLink(child, newUri);
							} catch (err) {
								log.notifyError(`Failed to handle rename`, err);
							}
						}
					}
				} else if (isFile) {
					try {
						this.moveLink(file.oldUri.toString(), file.newUri.toString());
					} catch (err) {
						log.notifyError(`Failed to handle rename`, err);
					}
				}
			}

			await this.save();
		} catch (error) {
			log.error('Failed to handle rename event', error);
		}
	}

	private isDescendant(parent: vscode.Uri, candidate: vscode.Uri): boolean {
		if (parent.scheme !== candidate.scheme || parent.authority !== candidate.authority) {
			return false;
		}

		const parentPath = parent.path.endsWith('/') ? parent.path : parent.path + '/';
		const childPath = candidate.path;

		return childPath === parent.path || childPath.startsWith(parentPath);
	}

	clearTemplateLinks(): TemplateLinkManager {
		this.linkMap.clear();
		return this;
	}

	removeLink(uriString: string): TemplateLinkManager {
		this.linkMap.delete(uriString);
		return this;
	}

	addLink(link: TemplateLink): TemplateLinkManager {
		this.linkMap.set(link.uriString, link);
		return this;
	}

	moveLink(oldUriString: string, newUriString: string): TemplateLinkManager {
		const link = this.linkMap.get(oldUriString);
		if (link === undefined) throw log.error(`Tried to move a link that doesn't exist`, oldUriString, newUriString);

		link.uriString = newUriString;

		this.removeLink(oldUriString).addLink(link);

		log.trace(`Move processed for  (${oldUriString} => (${newUriString}) `);

		return this;
	}

	async save(): Promise<TemplateLinkManager> {
		const links: TemplateLink[] = Array.from(this.linkMap.values());
		await context.globalState.update(this.stateKey, links);
		this.updateLinkedTemplatesContext(links);
		this.linksSavedEmitter.fire({ links });
		return this;
	}

	private updateLinkedTemplatesContext(links: TemplateLink[]) {
		const pathObject: Record<string, boolean> = {};
		for (const link of links) {
			pathObject[vscode.Uri.parse(link.uriString).fsPath] = true;
		}
		vscode.commands.executeCommand('setContext', `${extPrefix}.linkedTemplates`, pathObject);
	}

	loadLinks(): TemplateLinkManager {
		const links = context.globalState.get<TemplateLink[]>(this.stateKey) ?? [];
		this.linkMap.clear();

		for (const link of links) {
			this.addLink(link);
		}
		this.loaded = true;
		this.updateLinkedTemplatesContext(links);

		return this;
	}

	loadIfNotAlready(): TemplateLinkManager {
		if (!this.loaded) this.loadLinks();
		return this;
	}

	isLinked(uri: vscode.Uri): boolean {
		this.loadIfNotAlready();
		return this.linkMap.has(uri.toString());
	}

	getLink(uri: vscode.Uri): TemplateLink {
		this.loadIfNotAlready();
		const link = this.linkMap.get(uri.toString());

		if (link === undefined) throw log.error(`Could not find link for uri ${uri.toString()}`);

		return link;
	}

	getAllUriStrings(): string[] {
		this.loadIfNotAlready();
		return Array.from(this.linkMap.keys());
	}

	getAllUris(): vscode.Uri[] {
		this.loadIfNotAlready();
		return Array.from(this.linkMap.keys()).map(uri => vscode.Uri.parse(uri));
	}
})();
