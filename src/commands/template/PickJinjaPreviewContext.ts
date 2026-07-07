import { context as extContext } from '@global';
import { LinkManager, orgForTemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { ensureSavedDocument, log } from '@utils';
import { JinjaPreviewSession } from '../../ui/jinja/JinjaPreviewSession';
import GenericCommand from '../GenericCommand';

export class PickJinjaPreviewContext extends GenericCommand {
	commandName = 'PickJinjaPreviewContext';

	async execute(...args: unknown[]): Promise<void> {
		log.trace('PickJinjaPreviewContext: starting');

		try {
			const document = await ensureSavedDocument(args);
			// The button is reachable from any of the 3 panes (template, vars/overrides,
			// rendered) — resolve back to the owning template uri when invoked from one
			// of the other two.
			const templateUri = JinjaPreviewSession.resolveTemplateUri(document.uri) ?? document.uri;
			const link = LinkManager.getTemplateLink(templateUri);
			const org = orgForTemplateLink(link);
			// Verify a session exists for the org before opening/using the preview panes.
			await SessionManager.getSessionForOrg(org.id);
			await JinjaPreviewSession.pickContext(templateUri, extContext);
		} catch (e) {
			log.notifyError('Failed to pick Jinja preview context:', e);
		}
	}
}
