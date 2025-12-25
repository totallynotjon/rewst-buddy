import { SessionManager } from '@client';
import { log } from '@log';
import { SimpleTemplate } from '@models';
import vscode from 'vscode';
import TemplateLinkManager from './TemplateLinkManager';

export default class TemplateSyncManager {
	public static async updateTemplateBody(editor: vscode.TextEditor) {
		const link = TemplateLinkManager.linkFromEditor(editor);

		const session = await SessionManager.getProfileSession(link.sessionProfile);

		try {
			const response = await session.sdk?.updateTemplateBody({
				id: link.template.id,
				body: editor.document.getText() ?? '',
			});
			log.debug('Template response:', response?.updateTemplate);

			if (response?.updateTemplate?.id === undefined) {
				throw new Error();
			}

			link.template.body = response.updateTemplate?.body ?? '';
			link.template.updatedAt = response.updateTemplate.updatedAt;

			TemplateLinkManager.saveLink(link);

			log.info('Saved updated info to template');
		} catch {
			throw log.error('Failure in response from ticket update, unknown if successful');
		}
	}

	public static async syncTemplate(editor: vscode.TextEditor) {
		const link = TemplateLinkManager.linkFromEditor(editor);
		log.debug('Syncing template:', link);

		const session = await SessionManager.getProfileSession(link.sessionProfile);
		let response;
		try {
			response = await session.sdk?.getTemplate({
				id: link.template.id,
			});

			if (response?.template?.updatedAt === undefined) {
				throw new Error();
			}
		} catch {
			throw log.error('Failure to validate template has not been modified. Cannot push template update to rewst');
		}
		const rewstUpdatedAt = response.template.updatedAt;

		log.debug(`Local: ${link.template.updatedAt}`);
		log.debug(`Rewst: ${rewstUpdatedAt}`);

		if (link.template.updatedAt.localeCompare(rewstUpdatedAt) === 0) {
			await TemplateSyncManager.updateTemplateBody(editor);
		} else {
			log.info(`Rewst and last update of local template are out of sync need to remediate before push`);

			const choice = await vscode.window.showInformationMessage(
				'Template and Rewst are out of sync! Do you wish to force upload to rewst, or download the latest version of the template?',
				{ modal: true },
				'Force Override',
				'Download Latest',
			);

			switch (choice) {
				case 'Force Override':
					await TemplateSyncManager.updateTemplateBody(editor);
					break;
				case 'Download Latest':
					editor.edit(builder => {
						const doc = editor.document;
						builder.replace(
							new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end),
							response.template?.body ?? '',
						);
					});
					if ((await vscode.workspace.save(editor.document.uri)) === undefined) {
						throw log.error('Failed to save downloaded template to active editor');
					}
					TemplateLinkManager.saveLink({
						sessionProfile: session.profile,
						template: SimpleTemplate(response.template),
						uriString: editor.document.uri.toString(),
					});

					break;
				case undefined:
					throw log.error('Sync Operation Aborted');
			}
			log.debug('User choice:', choice);
		}
	}
}
