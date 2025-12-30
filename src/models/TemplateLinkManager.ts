import { onLinksSaved } from '@events';
import { context } from '@global';
import { log } from '@utils';
import vscode from 'vscode';
import TemplateLink from './TemplateLink';

export const TemplateLinkManager = new (class TemplateLinkManager {
	readonly stateKey = 'RewstTemplateLinks';
	linkMap = new Map<string, TemplateLink>();
	loaded = false;

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
		await onLinksSaved();
		return this;
	}

	loadLinks(): TemplateLinkManager {
		const links = context.globalState.get<TemplateLink[]>(this.stateKey) ?? [];
		this.linkMap.clear();

		for (const link of links) {
			this.addLink(link);
		}
		this.loaded = true;
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
