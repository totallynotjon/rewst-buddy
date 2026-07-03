import { buildTemplateLink, LinkManager, SyncManager } from '@models';
import type { Session } from '@sessions';
import { log } from '@utils';
import type { TextDocument } from 'vscode';

export async function linkDocumentToTemplate(
	document: TextDocument,
	session: Session,
	templateId: string,
	logSource: string,
): Promise<void> {
	log.debug(`${logSource}: fetching template`, { templateId });
	const template = await session.getTemplate(templateId);
	template.updatedAt = '0';
	template.body = '';

	const body = document.getText();
	const templateLink = buildTemplateLink(template, body, document.uri.toString());

	log.trace(`${logSource}: adding link and syncing`);
	await LinkManager.addLink(templateLink);
	await SyncManager.syncTemplate(document);

	log.notifyInfo('SUCCESS: Linked template');
}
