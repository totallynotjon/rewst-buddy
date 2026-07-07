import { context as extContext } from '@global';
import { LinkManager, orgForTemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { ensureSavedDocument, log } from '@utils';
import { JinjaPreviewPanel } from '../../ui/webview/JinjaPreviewPanel';
import GenericCommand from '../GenericCommand';

export class PreviewJinjaRender extends GenericCommand {
	commandName = 'PreviewJinjaRender';

	async execute(...args: unknown[]): Promise<void> {
		log.trace('PreviewJinjaRender: starting');

		try {
			const document = await ensureSavedDocument(args);
			const link = LinkManager.getTemplateLink(document.uri);
			const org = orgForTemplateLink(link);
			// Verify a session exists for the org before opening the panel.
			await SessionManager.getSessionForOrg(org.id);
			await JinjaPreviewPanel.createOrShow(document.uri, extContext.extensionUri);
		} catch (e) {
			log.notifyError('Failed to open Jinja preview:', e);
		}
	}
}
