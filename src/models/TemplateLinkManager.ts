import { context } from '@global';
import { log } from '@log';
import vscode from 'vscode';
import TemplateLink from './TemplateLink';

export default class TemplateLinkManager {
	static async clearTemplateLinks() {
		await context.globalState.update(TemplateLinkManager.stateKey, []);
	}
	static stateKey = 'RewstTemplateLinks';

	public static saveLink(link: TemplateLink) {
		if (link.uriString === 'untitled:Untitled-1') {
			log.notifyError("Can't link to unsaved document");
			return;
		}
		const links = TemplateLinkManager.getLinks()
			.filter(l => l.uriString !== link.uriString)
			.concat(link);

		context.globalState.update(TemplateLinkManager.stateKey, links);

		log.debug('Saved new link:', link);
	}

	public static getLinks(): TemplateLink[] {
		return context.globalState.get<TemplateLink[]>(TemplateLinkManager.stateKey) ?? [];
	}

	public static isLinked(uri: vscode.Uri): boolean {
		try {
			TemplateLinkManager.getLink(uri);
			return true;
		} catch {
			return false;
		}
	}

	public static getLink(uri: vscode.Uri): TemplateLink {
		const links = TemplateLinkManager.getLinks();
		for (const link of links) {
			if (link.uriString === uri.toString()) {
				return link;
			}
		}
		throw log.error(`Could not find link for uri ${uri.toString()}`);
	}
}
