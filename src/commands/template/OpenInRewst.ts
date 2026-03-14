import { LinkManager } from '@models';
import { SessionManager } from '@sessions';
import { log, parseArgsUri } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenInRewst extends GenericCommand {
	commandName = 'OpenInRewst';

	async execute(...args: any[]): Promise<void> {
		let uri: vscode.Uri | undefined;
		try {
			uri = parseArgsUri(args);
		} catch {
			// no uri from args, fall through to active editor
		}

		if (!uri) {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				throw log.error('OpenInRewst: no active editor');
			}
			uri = editor.document.uri;
		}

		try {
			const link = LinkManager.getTemplateLink(uri);
			const session = SessionManager.getSessionForOrg(link.org.id);
			const baseUrl = session.profile.region.loginUrl;
			const url = `${baseUrl}/organizations/${link.org.id}/templates/${link.template.id}`;
			await vscode.env.openExternal(vscode.Uri.parse(url));
		} catch (e) {
			log.notifyError('Could not open template in Rewst', e);
		}
	}
}
