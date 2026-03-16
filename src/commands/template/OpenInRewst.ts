import { LinkManager } from '@models';
import { SessionManager } from '@sessions';
import { getRegionConfigs } from '../../sessions/RegionConfig';
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

			let baseUrl: string;
			try {
				const session = SessionManager.getSessionForOrg(link.org.id);
				baseUrl = session.profile.region.loginUrl;
			} catch {
				const knownProfile = SessionManager.getAllKnownProfiles().find(p =>
					p.allManagedOrgs.some(o => o.id === link.org.id),
				);
				baseUrl = knownProfile?.region.loginUrl ?? getRegionConfigs()[0].loginUrl;
			}

			const url = `${baseUrl}/organizations/${link.org.id}/templates/${link.template.id}`;
			await vscode.env.openExternal(vscode.Uri.parse(url));
		} catch (e) {
			log.notifyError('Could not open template in Rewst', e);
		}
	}
}
