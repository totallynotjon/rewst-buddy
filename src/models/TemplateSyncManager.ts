import { SessionManager } from '@client';
import { extPrefix } from '@global';
import { TemplateFragment } from '@sdk';
import { log } from '@utils';
import vscode from 'vscode';
import { TemplateLinkManager } from './TemplateLinkManager';

export const TemplateSyncManager = new (class TemplateSyncManager implements vscode.Disposable {
	private syncingUris = new Set<string>();
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.disposables.push(vscode.workspace.onDidSaveTextDocument(doc => this.handleSave(doc)));
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}

	private async handleSave(document: vscode.TextDocument): Promise<void> {
		log.trace('Handling save', document);

		const config = vscode.workspace.getConfiguration(extPrefix);
		const enabled = config.get<boolean>('enableSyncOnSave', false);

		if (!enabled) return;

		if (!TemplateLinkManager.isLinked(document.uri)) return;

		try {
			await this.syncTemplate(document);
			log.notifyInfo('SUCCESS: Synced template');
		} catch (e) {
			log.notifyError('Failed to sync template:', e);
		}
	}

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
		const uriKey = doc.uri.toString();

		if (this.syncingUris.has(uriKey)) {
			log.debug('Sync already in progress for this file, skipping');
			return;
		}

		this.syncingUris.add(uriKey);
		try {
			await this.syncTemplateInternal(doc);
		} catch (e) {
			throw log.error('', e);
		} finally {
			this.syncingUris.delete(uriKey);
		}
	}

	private async syncTemplateInternal(doc: vscode.TextDocument) {
		if (doc.isUntitled) {
			throw log.error('Attempting sync before document is titled/saved to disk. This should be impossible.');
		}

		if (doc.isDirty) {
			const resultUri = await doc.save();
			if (!resultUri) {
				throw log.error('Failed to save the active editor before attempting sync');
			}
		}

		const link = TemplateLinkManager.getLink(doc.uri);
		log.debug('Syncing template:', link);

		const session = await SessionManager.getProfileSession(link.sessionProfile);
		let remoteTemplate;
		try {
			remoteTemplate = await session.getTemplate(link.template.id);
		} catch {
			throw log.error(`Failed to get template from Rewst. If this continues, the template may have been deleted`);
		}

		log.debug(`Local: ${link.template.updatedAt}`);
		log.debug(`Rewst: ${remoteTemplate.updatedAt}`);

		const isInSync = link.template.updatedAt.localeCompare(remoteTemplate.updatedAt) === 0;

		if (isInSync) {
			await this.updateTemplateBody(doc);
		} else {
			await this.handleConflict(doc, session, remoteTemplate);
		}
	}

	private async handleConflict(
		doc: vscode.TextDocument,
		session: Awaited<ReturnType<typeof SessionManager.getProfileSession>>,
		remoteTemplate: TemplateFragment,
	) {
		log.info('Rewst and last update of local template are out of sync, need to remediate before push');

		const choice = await vscode.window.showInformationMessage(
			'Template and Rewst are out of sync! Do you wish to force upload to rewst, or download the latest version of the template?',
			{ modal: true },
			'Force Override',
			'Download Latest',
		);

		switch (choice) {
			case 'Force Override':
				await this.updateTemplateBody(doc);
				break;

			case 'Download Latest':
				await this.downloadAndApplyRemote(doc, session, remoteTemplate);
				break;

			case undefined:
				throw log.error('Sync Operation Aborted');
		}

		log.debug('User choice:', choice);
	}

	private async downloadAndApplyRemote(
		doc: vscode.TextDocument,
		session: Awaited<ReturnType<typeof SessionManager.getProfileSession>>,
		remoteTemplate: TemplateFragment,
	) {
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			doc.uri,
			new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end),
			remoteTemplate.body ?? '',
		);
		await vscode.workspace.applyEdit(edit);

		await TemplateLinkManager.addLink({
			sessionProfile: session.profile,
			template: remoteTemplate,
			uriString: doc.uri.toString(),
		}).save();

		if ((await vscode.workspace.save(doc.uri)) === undefined) {
			throw log.error('Failed to save downloaded template to active editor');
		}
	}
})();
