import { FolderLink, Link, TemplateLink } from '@models';
import { Session, SessionManager, TemplateFragment } from '@sessions';
import { log, makeUniqueUri, writeTextFile } from '@utils';
import vscode, { Uri } from 'vscode';
import { LinkManager } from './LinkManager';
import { SyncOnSaveManager } from './SyncOnSaveManager';

export const SyncManager = new (class _ implements vscode.Disposable {
	private syncingUris = new Set<string>();
	private disposables: vscode.Disposable[] = [];
	private interval!: NodeJS.Timeout;

	constructor() {
		this.disposables.push(vscode.workspace.onDidSaveTextDocument(async doc => await this.handleSave(doc)));
		this.disposables.push(vscode.workspace.onDidOpenTextDocument(async doc => await this.checkAutoFetch(doc)));
		this.interval = setInterval(() => this.fetchAllFolders(), 15 * 60 * 1000);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		clearInterval(this.interval);
	}

	private async checkAutoFetch(doc: vscode.TextDocument) {
		log.trace('checkAutoFetch: checking', doc.uri.fsPath);

		// only autofetch if sync on save enabled
		if (!SyncOnSaveManager.isUriSynced(doc.uri)) {
			log.trace('checkAutoFetch: sync not enabled, skipping');
			return;
		}

		const link = LinkManager.getTemplateLink(doc.uri);

		const session = SessionManager.getSessionForOrg(link.org.id);

		let remoteTemplate;
		try {
			log.trace('checkAutoFetch: fetching remote template', link.template.id);
			remoteTemplate = await session.getTemplate(link.template.id);
		} catch {
			log.trace('checkAutoFetch: failed to fetch remote, skipping');
			return;
		}
		if (doc.getText() !== link.template.body) {
			log.trace('checkAutoFetch: text has changed since last sync');
			return;
		}

		// if the remote template is in sync then we have nothing to fetch
		if (remoteTemplate.updatedAt === link.template.updatedAt) {
			log.trace('checkAutoFetch: remote in sync, no fetch needed');
			return;
		}

		// in this situation the files stats are the same since we last pushed to root,
		// aka no local edits have happened
		// we also have an update we can take down from rewst
		log.debug('checkAutoFetch: remote is newer, applying update', {
			local: link.template.updatedAt,
			remote: remoteTemplate.updatedAt,
		});
		await this.applyTemplatetoDocument(doc, session, remoteTemplate);
	}

	private async handleSave(document: vscode.TextDocument): Promise<void> {
		log.trace('Handling save', document);

		const enabled = SyncOnSaveManager.isUriSynced(document.uri);

		if (!enabled) return;

		try {
			await this.syncTemplate(document);
			log.notifyInfo('SUCCESS: Synced template');
		} catch (e) {
			log.notifyError('Failed to sync template:', e);
		}
	}

	async updateTemplateBody(doc: vscode.TextDocument) {
		log.trace('updateTemplateBody: starting', doc.uri.fsPath);
		const link = LinkManager.getTemplateLink(doc.uri);

		const session = SessionManager.getSessionForOrg(link.org.id);

		try {
			const body = doc.getText() ?? '';
			log.debug('updateTemplateBody: sending to Rewst', {
				templateId: link.template.id,
				bodyLength: body.length,
			});
			const response = await session.sdk?.updateTemplateBody({
				id: link.template.id,
				body: body,
			});
			log.debug('updateTemplateBody: response received', response?.template);

			if (response?.template?.id === undefined) {
				throw new Error('Failed to update template: Invalid response from Rewst API (missing template ID)');
			}

			link.template = response.template;
			await this.addLink(link, doc.uri);

			log.info('Saved updated info to template');
		} catch {
			throw log.error('Failure in response from ticket update, unknown if successful');
		}
	}

	async syncTemplate(doc: vscode.TextDocument) {
		log.trace('syncTemplate: starting', doc.uri.fsPath);
		const uriKey = doc.uri.toString();

		if (this.syncingUris.has(uriKey)) {
			log.debug('syncTemplate: already in progress, skipping');
			return;
		}

		this.syncingUris.add(uriKey);
		try {
			await this.syncTemplateInternal(doc);
			log.trace('syncTemplate: completed successfully');
		} catch (e) {
			throw log.error('syncTemplate: failed', e);
		} finally {
			this.syncingUris.delete(uriKey);
		}
	}

	private async syncTemplateInternal(doc: vscode.TextDocument) {
		log.trace('syncTemplateInternal: starting');

		if (doc.isUntitled) {
			throw log.error('syncTemplateInternal: document is untitled');
		}

		if (doc.isDirty) {
			log.trace('syncTemplateInternal: saving dirty document');
			const resultUri = await doc.save();
			if (!resultUri) {
				throw log.error('syncTemplateInternal: failed to save document');
			}
		}

		const link = LinkManager.getTemplateLink(doc.uri);
		log.debug('syncTemplateInternal: syncing template', {
			templateId: link.template.id,
			templateName: link.template.name,
		});

		const session = SessionManager.getSessionForOrg(link.org.id);

		let remoteTemplate;
		try {
			log.trace('syncTemplateInternal: fetching remote template');
			remoteTemplate = await session.getTemplate(link.template.id);
		} catch {
			throw log.error('syncTemplateInternal: failed to fetch remote template');
		}

		log.debug('syncTemplateInternal: comparing timestamps', {
			local: link.template.updatedAt,
			remote: remoteTemplate.updatedAt,
		});

		const isInSync = link.template.updatedAt === remoteTemplate.updatedAt;
		const bodySame = remoteTemplate.body === doc.getText();
		const bodyEmpty = doc.getText() === '';

		if (bodySame) {
			log.debug('syncTemplateInternal: body the same ensuring stat indicates in sync');

			const templateLink: TemplateLink = {
				type: 'Template',
				template: remoteTemplate,
				uriString: doc.uri.toString(),
				org: session.profile.org,
			};

			await this.addLink(templateLink, doc.uri);
		} else if (bodyEmpty) {
			log.debug('syncTemplateInternal: empty, downloading remote');
			await this.applyTemplatetoDocument(doc, session, remoteTemplate);
		} else if (isInSync) {
			log.debug('syncTemplateInternal: timestamps match, uploading local changes');
			await this.updateTemplateBody(doc);
		} else {
			log.debug('syncTemplateInternal: conflict detected, timestamps differ and body differs');
			await this.handleConflict(doc, session, remoteTemplate);
		}
	}

	private async handleConflict(doc: vscode.TextDocument, session: Session, remoteTemplate: TemplateFragment) {
		log.debug('handleConflict: conflict detected, prompting user');
		log.info('Rewst and last update of local template are out of sync, need to remediate before push');

		const choice = await vscode.window.showInformationMessage(
			'Template and Rewst are out of sync! Do you wish to force upload to rewst, or download the latest version of the template?',
			{ modal: true },
			'Force Override',
			'Download Latest',
		);

		log.debug('handleConflict: user chose', choice);

		switch (choice) {
			case 'Force Override':
				log.trace('handleConflict: force overriding remote');
				await this.updateTemplateBody(doc);
				break;

			case 'Download Latest':
				log.trace('handleConflict: downloading remote');
				await this.applyTemplatetoDocument(doc, session, remoteTemplate);
				break;

			case undefined:
				throw log.error('handleConflict: operation aborted by user');
		}
	}

	private async applyTemplatetoDocument(
		doc: vscode.TextDocument,
		session: Session,
		remoteTemplate: TemplateFragment,
	) {
		log.trace('applyTemplatetoDocument: applying remote template', {
			templateId: remoteTemplate.id,
			bodyLength: remoteTemplate.body?.length ?? 0,
		});

		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			doc.uri,
			new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end),
			remoteTemplate.body ?? '',
		);
		await vscode.workspace.applyEdit(edit);

		const templateLink: TemplateLink = {
			type: 'Template',
			template: remoteTemplate,
			uriString: doc.uri.toString(),
			org: session.profile.org,
		};

		await this.addLink(templateLink, doc.uri);

		if ((await vscode.workspace.save(doc.uri)) === undefined) {
			throw log.error('applyTemplatetoDocument: failed to save');
		}

		log.trace('applyTemplatetoDocument: completed');
	}

	private async addLink(link: Link, uri: Uri) {
		log.trace('SyncManager.addLink: updating link with', uri.fsPath);
		await LinkManager.addLink(link).save();
		log.trace('addLink: saved');
	}

	async fetchAllFolders() {
		log.debug('Fetching all folders');
		const links = LinkManager.getFolderLinks();
		for (const link of links) {
			await this.fetchFolder(link);
		}
	}

	async fetchFolder(folderLink: FolderLink) {
		log.trace('fetchFolder: starting', { org: folderLink.org.name, uri: folderLink.uriString });

		const { org, uriString } = folderLink;

		const ids = LinkManager.getOrgTemplateLinks(org).map(l => l.template.id);
		log.debug('fetchFolder: existing template count', ids.length);

		const session = SessionManager.getSessionForOrg(org.id);

		log.trace('fetchFolder: listing templates from Rewst');
		const response = await session.sdk?.listTemplates({ orgId: org.id });
		if (!response?.templates) throw log.notifyError("fetchFolder: couldn't load templates");

		const templates = response.templates;
		log.debug('fetchFolder: remote template count', templates.length);

		const missingTemplates = templates.filter(t => !ids.includes(t.id));
		log.debug('fetchFolder: missing templates to fetch', missingTemplates.length);

		for (const template of missingTemplates) {
			await this.makeTemplate(folderLink, template);
		}

		await LinkManager.save();
		log.trace('fetchFolder: completed');
		log.notifyInfo(`SUCCESS: Fetched ${missingTemplates.length} templates into the folder`);
	}

	private async makeTemplate(folderLink: FolderLink, template: TemplateFragment) {
		log.trace('makeTemplate: creating file', { templateId: template.id, templateName: template.name });

		const folderUri = vscode.Uri.parse(folderLink.uriString);
		const templateUri = await makeUniqueUri(folderUri, template.name);

		try {
			await writeTextFile(templateUri, template.body);
			log.trace('makeTemplate: file written', templateUri.fsPath);
		} catch (err) {
			log.warn(`makeTemplate: failed to create file for "${template.name}": ${err}`);
			return;
		}

		const templateLink: TemplateLink = {
			type: 'Template',
			template: template,
			uriString: templateUri.toString(),
			org: folderLink.org,
		};

		await this.addLink(templateLink, templateUri);
	}
})();
