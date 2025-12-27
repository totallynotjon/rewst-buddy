import { SessionManager } from '@client';
import { log } from '@log';
import vscode from 'vscode';
import { TemplateLinkManager } from './TemplateLinkManager';

export const TemplateSyncManager = new (class TemplateSyncManager {
	async updateTemplateBody(doc: vscode.TextDocument) {
		const link = TemplateLinkManager.getLink(doc.uri);

		const session = await SessionManager.getProfileSession(link.sessionProfile);

		try {
			const response = await session.sdk?.updateTemplateBody({
				id: link.template.id,
				body: doc.getText() ?? '',
			});
			log.debug('Template response:', response?.template);

			if (response?.template?.id === undefined) {
				throw new Error();
			}

			link.template = response.template;

			TemplateLinkManager.addLink(link).save();

			log.info('Saved updated info to template');
		} catch {
			throw log.error('Failure in response from ticket update, unknown if successful');
		}
	}

	async syncTemplate(doc: vscode.TextDocument) {
		if (doc.isUntitled) {
			throw log.error('Attempting sync before document is titled/saved to disk. This should be impossible.');
		}

		if (doc.isDirty) {
			const resultUri = await vscode.workspace.save(doc.uri);

			if (!resultUri) {
				throw log.error('Failed to save the active editor before attempting sync');
			}
		}

		const link = TemplateLinkManager.getLink(doc.uri);
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
			await this.updateTemplateBody(doc);
		} else {
			log.info(`Rewst and last update of local template are out of sync need to remediate before push`);

			const choice = await vscode.window.showInformationMessage(
				'Template and Rewst are out of sync! Do you wish to force upload to rewst, or download the latest version of the template?',
				{ modal: true },
				'Force Override',
				'Download Latest',
			);
			const editor = new vscode.WorkspaceEdit();

			switch (choice) {
				case 'Force Override':
					await this.updateTemplateBody(doc);
					break;
				case 'Download Latest':
					editor.replace(
						doc.uri,
						new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end),
						response.template?.body ?? '',
					);
					await vscode.workspace.applyEdit(editor);

					await TemplateLinkManager.addLink({
						sessionProfile: session.profile,
						template: response.template,
						uriString: doc.uri.toString(),
					}).save();

					if ((await vscode.workspace.save(doc.uri)) === undefined) {
						throw log.error('Failed to save downloaded template to active editor');
					}

					break;
				case undefined:
					throw log.error('Sync Operation Aborted');
			}
			log.debug('User choice:', choice);
		}
	}
})();
