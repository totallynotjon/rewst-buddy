import { LinkManager } from '@models';
import vscode from 'vscode';
import { log } from './log';

/**
 * Throws if the document at the given URI is already linked to a template.
 */
export function requireUnlinked(uri: vscode.Uri): void {
	if (LinkManager.isLinked(uri)) {
		const link = LinkManager.getTemplateLink(uri);
		throw log.notifyError(`Already linked to ${link.template.name} in ${link.template.orgId}/${link.org.name}`);
	}
}
