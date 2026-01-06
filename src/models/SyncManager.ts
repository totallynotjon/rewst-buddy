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
		// only autofetch if sync on save enabled
		if (!SyncOnSaveManager.isUriSynced(doc.uri)) return;

		const link = LinkManager.getTemplateLink(doc.uri);

		// Skip autofetch for legacy links without stat info
		if (!link.stat) return;

		const stat = await vscode.workspace.fs.stat(doc.uri);

		// if the file has been modified locally then we can't act
		if (stat.mtime !== link.stat.mtime) return;
		if (stat.size !== link.stat.size) return;

		const session = SessionManager.getSessionForOrg(link.org.id);

		let remoteTemplate;
		try {
			remoteTemplate = await session.getTemplate(link.template.id);
		} catch {
			return;
		}

		// if the remote template is in sync then we have nothing to fetch
		if (remoteTemplate.updatedAt.localeCompare(link.template.updatedAt) === 0) return;

		// in this situation the files stats are the same since we last pushed to root,
		// aka no local edits have happened
		// we also have an update we can take down from rewst
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
		const link = LinkManager.getTemplateLink(doc.uri);

		const session = SessionManager.getSessionForOrg(link.org.id);

		try {
			const response = await session.sdk?.updateTemplateBody({
				id: link.template.id,
				body: doc.getText() ?? '',
			});
			log.debug('Template response:', response?.template);

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
		const uriKey = doc.uri.toString();

		if (this.syncingUris.has(uriKey)) {
			log.debug('Sync already in progress for this file, skipping');
			return;
		}

		this.syncingUris.add(uriKey);
		try {
			await this.syncTemplateInternal(doc);
		} catch (e) {
			throw log.error('Failed to sync template to Rewst', e);
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
		const link = LinkManager.getTemplateLink(doc.uri);
		log.debug('Syncing template:', link);

		const session = SessionManager.getSessionForOrg(link.org.id);

		let remoteTemplate;
		try {
			remoteTemplate = await session.getTemplate(link.template.id);
		} catch {
			throw log.error(`Failed to get template from Rewst. If this continues, the template may have been deleted`);
		}

		log.debug(`Local: ${link.template.updatedAt}`);
		log.debug(`Rewst: ${remoteTemplate.updatedAt}`);

		const isInSync = link.template.updatedAt.localeCompare(remoteTemplate.updatedAt) === 0;
		const bodySame = remoteTemplate.body.localeCompare(doc.getText()) === 0;
		const bodyEmpty = doc.getText() === '';

		if (bodySame || bodyEmpty) {
			await this.applyTemplatetoDocument(doc, session, remoteTemplate);
		} else if (isInSync) {
			await this.updateTemplateBody(doc);
		} else {
			await this.handleConflict(doc, session, remoteTemplate);
		}
	}

	private async handleConflict(doc: vscode.TextDocument, session: Session, remoteTemplate: TemplateFragment) {
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
				await this.applyTemplatetoDocument(doc, session, remoteTemplate);
				break;

			case undefined:
				throw log.error('Sync Operation Aborted');
		}

		log.debug('User choice:', choice);
	}

	private async applyTemplatetoDocument(
		doc: vscode.TextDocument,
		session: Session,
		remoteTemplate: TemplateFragment,
	) {
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
			throw log.error('Failed to save downloaded template to active editor');
		}
	}

	private async addLink(link: Link, uri: Uri) {
		const stat = await vscode.workspace.fs.stat(uri);
		link.stat = stat;
		await LinkManager.addLink(link).save();
	}

	async fetchAllFolders() {
		log.debug('Fetching all folders');
		const links = LinkManager.getFolderLinks();
		for (const link of links) {
			await this.fetchFolder(link);
		}
	}

	async fetchFolder(folderLink: FolderLink) {
		log.debug(`Fetching templates for folder ${folderLink.org.name}: ${folderLink.uriString}`);

		const { org, uriString } = folderLink;

		const ids = LinkManager.getOrgTemplateLinks(org).map(l => l.template.id);

		const session = SessionManager.getSessionForOrg(org.id);

		const response = await session.sdk?.listTemplates({ orgId: org.id });
		if (!response?.templates) throw log.notifyError("Couldn't load templates for organization");

		const templates = response.templates;

		const missingTemplates = templates.filter(t => !ids.includes(t.id));
		log.debug('Missing templates:', missingTemplates);

		for (const template of missingTemplates) {
			await this.makeTemplate(folderLink, template);
		}

		await LinkManager.save();
		log.notifyInfo(`SUCCESS: Fetched ${missingTemplates.length} templates into the folder`);
	}

	private async makeTemplate(folderLink: FolderLink, template: TemplateFragment) {
		const folderUri = vscode.Uri.parse(folderLink.uriString);
		const templateUri = await makeUniqueUri(folderUri, template.name);

		try {
			await writeTextFile(templateUri, template.body);
		} catch (err) {
			log.warn(`Failed to create template file for "${template.name}": ${err}`);
			return;
		}

		const templateLink: TemplateLink = {
			type: 'Template',
			template: template,
			uriString: templateUri.toString(),
			org: folderLink.org,
		};

		this.addLink(templateLink, templateUri);
	}
})();
