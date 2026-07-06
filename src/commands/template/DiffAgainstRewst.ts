import { LinkManager, showRewstDiff } from '@models';
import { SessionManager } from '@sessions';
import { ensureSavedDocument, log } from '@utils';
import GenericCommand from '../GenericCommand';

export class DiffAgainstRewst extends GenericCommand {
	commandName = 'DiffAgainstRewst';

	async execute(...args: unknown[]): Promise<void> {
		log.trace('DiffAgainstRewst: starting');

		try {
			const document = await ensureSavedDocument(args);
			const link = LinkManager.getTemplateLink(document.uri);
			const session = await SessionManager.getSessionForOrg(link.org.id);
			const remoteTemplate = await session.getTemplate(link.template.id);
			await showRewstDiff(document, remoteTemplate.body, 'Local ↔ Rewst');
		} catch (e) {
			log.notifyError('Failed to diff against Rewst:', e);
		}
	}
}
