import { TemplateLinkManager } from '@models';
import { log } from './log';
import vscode from 'vscode';

/**
 * Throws if the document at the given URI is already linked to a template.
 */
export function requireUnlinked(uri: vscode.Uri): void {
	if (TemplateLinkManager.isLinked(uri)) {
		const link = TemplateLinkManager.getLink(uri);
		throw log.notifyError(
			`Already linked to ${link.template.name} in ${link.template.orgId}/${link.sessionProfile.label}`,
		);
	}
}
