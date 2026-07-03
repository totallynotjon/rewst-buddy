import type { SessionChangeEvent } from '@events';
import { FolderLink, Link, TemplateLink } from '@models';
import { FullTemplateFragment, Session, SessionManager } from '@sessions';
import { findAllTemplateReferences, getHash, log, makeUniqueUri, writeTextFile } from '@utils';
import vscode, { Uri } from 'vscode';
import { LinkManager } from './LinkManager';
import { SyncOnSaveManager } from './SyncOnSaveManager';
import { determineSyncAction, type SyncDecision } from './syncDecision';
import { buildTemplateLink, orgFromTemplate } from './templateLinkFactory';
import { nonEmptyString } from './types';

export { orgFromTemplate } from './templateLinkFactory';

/**
 * Everything needed to act on a sync without re-fetching: the link, the session
 * resolved for its org, the remote template (body intact), the current local
 * body, and the computed action. Shared by the save-driven sync and the
 * non-interactive MCP sync tools so they decide identically.
 */
export interface SyncDecisionContext {
	link: TemplateLink;
	session: Session;
	remoteTemplate: FullTemplateFragment;
	localBody: string;
	decision: SyncDecision;
}

export const SyncManager = new (class _ implements vscode.Disposable {
	private syncingUris = new Set<string>();
	private disposables: vscode.Disposable[] = [];
	private documentEventDisposables: vscode.Disposable[] = [];
	private interval: NodeJS.Timeout | undefined;
	private isActive = false;

	init(): _ {
		// Subscribe to session changes
		this.disposables.push(SessionManager.onSessionChange(e => this.handleSessionChange(e)));

		// Check initial state (sessions may already exist from loadSessions())
		if (SessionManager.getActiveSessions().length > 0) {
			this.activate();
		}

		return this;
	}

	private handleSessionChange(event: SessionChangeEvent): void {
		const hasActiveSessions = event.activeProfiles.length > 0;

		if (hasActiveSessions && !this.isActive) {
			this.activate();
		} else if (!hasActiveSessions && this.isActive) {
			this.deactivate();
		}
	}

	private activate(): void {
		if (this.isActive) return;

		log.debug('SyncManager: activating document listeners and folder fetch interval');
		this.isActive = true;

		// Register document event listeners
		this.documentEventDisposables.push(
			vscode.workspace.onDidSaveTextDocument(async doc => await this.handleSave(doc)),
		);
		this.documentEventDisposables.push(
			vscode.workspace.onDidOpenTextDocument(async doc => await this.checkAutoFetch(doc)),
		);

		// Start the folder fetch interval
		this.interval = setInterval(() => this.fetchAllFolders(), 15 * 60 * 1000);
	}

	private deactivate(): void {
		if (!this.isActive) return;

		log.debug('SyncManager: deactivating document listeners and folder fetch interval');
		this.isActive = false;

		// Dispose document event listeners
		this.documentEventDisposables.forEach(d => d.dispose());
		this.documentEventDisposables = [];

		// Clear the interval
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = undefined;
		}
	}

	dispose(): void {
		this.deactivate();
		this.disposables.forEach(d => d.dispose());
	}

	private async checkAutoFetch(doc: vscode.TextDocument) {
		log.trace('checkAutoFetch: checking', doc.uri.fsPath);

		// Check if autoFetch is enabled via configuration
		const config = vscode.workspace.getConfiguration('rewst-buddy');
		if (!config.get<boolean>('autoFetchOnOpen', true)) {
			log.trace('checkAutoFetch: disabled by configuration, skipping');
			return;
		}

		if (!LinkManager.isLinked(doc.uri)) {
			log.trace('checkAutoFetch: file not linked, skipping');
			return;
		}

		const rawLink = LinkManager.linkMap.get(doc.uri.toString());
		if (!rawLink || rawLink.type !== 'Template') {
			log.trace('checkAutoFetch: not a template link, skipping');
			return;
		}
		const link = rawLink as TemplateLink;

		const session = await SessionManager.getSessionForOrg(link.org.id);

		let remoteTemplate;
		try {
			log.trace('checkAutoFetch: fetching remote template', link.template.id);
			remoteTemplate = await session.getTemplate(link.template.id);
		} catch {
			log.trace('checkAutoFetch: failed to fetch remote, skipping');
			return;
		}

		try {
			this.verifyRemoteTemplateOrg(link, remoteTemplate, session);
		} catch {
			// verifyRemoteTemplateOrg already logged; an open event must not throw.
			return;
		}

		if (link.bodyHash !== getHash(doc.getText())) {
			log.trace('checkAutoFetch: file has changed since last sync');
			return;
		}

		// Only fetch when the remote is provably newer: both timestamps must parse
		// and the remote instant must be strictly later than the last-known one.
		const remoteInstant = Date.parse(remoteTemplate.updatedAt ?? '');
		const localInstant = Date.parse(link.template.updatedAt ?? '');
		if (Number.isNaN(remoteInstant) || Number.isNaN(localInstant) || remoteInstant <= localInstant) {
			log.trace('checkAutoFetch: remote is not provably newer, no fetch needed');
			return;
		}

		// in this situation the files stats are the same since we last pushed to root,
		// aka no local edits have happened
		// we also have an update we can take down from rewst
		log.debug('checkAutoFetch: remote is newer, applying update', {
			local: link.template.updatedAt,
			remote: remoteTemplate.updatedAt,
		});
		await this.applyTemplateToDocument(doc, session, remoteTemplate);
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

	async updateTemplateBody(doc: vscode.TextDocument, session: Session) {
		log.trace('updateTemplateBody: starting', doc.uri.fsPath);
		const link = LinkManager.getTemplateLink(doc.uri);

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
			link.bodyHash = getHash(body);
			link.referencedTemplateIds = findAllTemplateReferences(body);
			this.addLink(link, doc.uri);

			log.info('Saved updated info to template');
		} catch (e) {
			throw log.error('Failure in response from ticket update, unknown if successful', e);
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

		const { link, session, remoteTemplate, localBody, decision } = await this.computeSyncDecision(doc);
		log.debug('syncTemplateInternal: syncing template', {
			templateId: link.template.id,
			templateName: link.template.name,
			action: decision.action,
		});

		switch (decision.action) {
			case 'update-metadata':
				// Bodies match - just refresh link metadata with the latest remote info.
				this.refreshLinkMetadata(doc, session, remoteTemplate, localBody);
				break;

			case 'download-remote':
				log.debug('syncTemplateInternal: downloading remote (local empty)');
				await this.applyTemplateToDocument(doc, session, remoteTemplate);
				break;

			case 'upload-local':
				log.debug('syncTemplateInternal: uploading local changes (in sync)');
				await this.updateTemplateBody(doc, session);
				break;

			case 'conflict':
				log.debug('syncTemplateInternal: conflict detected');
				await this.handleConflict(doc, session, remoteTemplate, decision);
				break;
		}
	}

	/**
	 * Fails closed unless the fetched remote template belongs to the org the
	 * link is expected to live in. The expected org is the link's trusted
	 * template-owner metadata when present, otherwise the stored link org. A
	 * legacy link without trusted owner metadata may only be corrected to the
	 * remote owner when the template ids match and the resolving session
	 * manages that owner.
	 */
	private verifyRemoteTemplateOrg(link: TemplateLink, remoteTemplate: FullTemplateFragment, session: Session): void {
		const remoteOrgId = nonEmptyString(remoteTemplate.orgId) ?? nonEmptyString(remoteTemplate.organization?.id);
		if (remoteOrgId === undefined) {
			throw log.error('Sync rejected: the remote template has no owning organization');
		}

		const trustedOrgId = nonEmptyString(link.template.orgId) ?? nonEmptyString(link.template.organization?.id);
		const expectedOrgId = trustedOrgId ?? link.org.id;
		if (remoteOrgId === expectedOrgId) {
			return;
		}

		// Legacy link without trusted owner metadata: allow the remote owner to
		// correct the stored org only when the ids match and this session manages
		// the owner; anything else fails closed.
		if (trustedOrgId === undefined) {
			const sessionManagesOwner =
				session.profile.org.id === remoteOrgId ||
				session.profile.allManagedOrgs.some(org => org.id === remoteOrgId);
			if (remoteTemplate.id === link.template.id && sessionManagesOwner) {
				return;
			}
		}

		throw log.error(
			`Sync rejected: remote template belongs to org '${remoteOrgId}' but the link expects org '${expectedOrgId}'`,
		);
	}

	/**
	 * Gathers the remote template and computes the sync action for a linked
	 * document without mutating local or remote state. The interactive
	 * save-driven sync and the non-interactive MCP sync tools both build on this
	 * so they decide identically. Throws if the document is not a template link,
	 * the remote template cannot be fetched, or the remote template does not
	 * belong to the link's expected organization.
	 */
	async computeSyncDecision(doc: vscode.TextDocument): Promise<SyncDecisionContext> {
		const link = LinkManager.getTemplateLink(doc.uri);
		const session = await SessionManager.getSessionForOrg(link.org.id);

		let remoteTemplate: FullTemplateFragment;
		try {
			log.trace('computeSyncDecision: fetching remote template', link.template.id);
			remoteTemplate = await session.getTemplate(link.template.id);
		} catch (e) {
			throw log.error('computeSyncDecision: failed to fetch remote template', e);
		}

		this.verifyRemoteTemplateOrg(link, remoteTemplate, session);

		const localBody = doc.getText();
		const decision = determineSyncAction({
			localUpdatedAt: link.template.updatedAt,
			remoteUpdatedAt: remoteTemplate.updatedAt,
			localBody,
			remoteBody: remoteTemplate.body,
			lastSyncedBodyHash: link.bodyHash,
		});

		log.debug('computeSyncDecision: states', {
			localUpdatedAt: link.template.updatedAt,
			remoteUpdatedAt: remoteTemplate.updatedAt,
			storedBodyHash: link.bodyHash,
			currentBodyHash: getHash(localBody),
			action: decision.action,
		});

		return { link, session, remoteTemplate, localBody, decision };
	}

	/**
	 * Refreshes a template link's metadata from the latest remote state when the
	 * local and remote bodies already match (the 'update-metadata' action). The
	 * link stores an empty body, matching how links are persisted elsewhere.
	 */
	refreshLinkMetadata(
		doc: vscode.TextDocument,
		_session: Session,
		remoteTemplate: FullTemplateFragment,
		localBody: string,
	): void {
		remoteTemplate.body = '';
		const templateLink = buildTemplateLink(remoteTemplate, localBody, doc.uri.toString());
		this.addLink(templateLink, doc.uri);
	}

	private async handleConflict(
		doc: vscode.TextDocument,
		session: Session,
		remoteTemplate: FullTemplateFragment,
		decision: Extract<SyncDecision, { action: 'conflict' }>,
	) {
		log.debug('handleConflict: conflict detected, prompting user');
		log.info('Rewst and last update of local template are out of sync, need to remediate before push');

		const choice = await vscode.window.showInformationMessage(
			`Template and Rewst are out of sync. ${this.describeConflict(decision.changed)} Do you wish to force upload to Rewst, or download the latest version of the template?`,
			{ modal: true },
			'Force Override',
			'Download Latest',
		);

		log.debug('handleConflict: user chose', choice);

		switch (choice) {
			case 'Force Override': {
				log.trace('handleConflict: force overriding remote');
				// Re-resolve rather than reusing the session captured before this
				// modal: the user may take arbitrarily long to respond, during which
				// the session could be refreshed, removed, or replaced.
				const link = LinkManager.getTemplateLink(doc.uri);
				const freshSession = await SessionManager.getSessionForOrg(link.org.id);
				await this.updateTemplateBody(doc, freshSession);
				break;
			}

			case 'Download Latest':
				log.trace('handleConflict: downloading remote');
				await this.applyTemplateToDocument(doc, session, remoteTemplate);
				break;

			case undefined:
				throw log.error('handleConflict: operation aborted by user');
		}
	}

	private describeConflict(changed: Extract<SyncDecision, { action: 'conflict' }>['changed']): string {
		switch (changed) {
			case 'local':
				return 'The local template changed since the last sync.';
			case 'remote':
				return 'The Rewst template changed since the last sync.';
			case 'both':
				return 'The local file and Rewst template both changed since the last sync.';
		}
	}

	async applyTemplateToDocument(doc: vscode.TextDocument, _session: Session, remoteTemplate: FullTemplateFragment) {
		log.trace('applyTemplateToDocument: applying remote template', {
			templateId: remoteTemplate.id,
			bodyLength: remoteTemplate.body?.length ?? 0,
		});

		const body = remoteTemplate.body;
		remoteTemplate.body = '';

		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			doc.uri,
			new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end),
			body,
		);
		await vscode.workspace.applyEdit(edit);

		const templateLink = buildTemplateLink(remoteTemplate, body, doc.uri.toString());

		this.addLink(templateLink, doc.uri);

		if ((await vscode.workspace.save(doc.uri)) === undefined) {
			throw log.error('applyTemplateToDocument: failed to save');
		}

		log.trace('applyTemplateToDocument: completed');
	}

	private addLink(link: Link, uri: Uri) {
		log.trace('SyncManager.addLink: updating link with', uri.fsPath);
		LinkManager.addLink(link);
		log.trace('addLink: saved');
	}

	async fetchAllFolders() {
		if (!this.isActive) return;

		log.debug('Fetching all folders');
		const links = LinkManager.getFolderLinks();
		for (const link of links) {
			if (!this.isActive) break; // Stop if deactivated mid-fetch
			try {
				await this.fetchFolder(link);
			} catch (e) {
				// One folder's failure (e.g. its org's session was removed) must
				// not stop the remaining folders from being fetched.
				log.error(`fetchAllFolders: failed to fetch folder ${link.uriString}`, e);
			}
		}
	}

	async fetchFolder(folderLink: FolderLink) {
		log.trace('fetchFolder: starting', { org: folderLink.org.name, uri: folderLink.uriString });

		const { org, uriString } = folderLink;

		const ids = new Set(LinkManager.getOrgTemplateLinks(org).map(l => l.template.id));
		log.debug('fetchFolder: existing template count', ids.size);

		const session = await SessionManager.getSessionForOrg(org.id);

		log.trace('fetchFolder: listing templates from Rewst');
		const response = await session.sdk?.listTemplates({ orgId: org.id });
		if (!response?.templates) throw log.notifyError("fetchFolder: couldn't load templates");

		const templates = response.templates;
		log.debug('fetchFolder: remote template count', templates.length);

		const missingTemplates = templates.filter(t => !ids.has(t.id));
		log.debug('fetchFolder: missing templates to fetch', missingTemplates.length);

		if (missingTemplates.length === 0) {
			log.trace('fetchFolder: no missing templates');
			return;
		}

		// BEGIN BATCH MODE - defer saves until all templates processed
		LinkManager.beginBatch();
		let successCount = 0;
		try {
			const folderUri = vscode.Uri.parse(uriString);
			const CHUNK_SIZE = 20;

			// Phase 1: Generate unique URIs (must be sequential for conflict detection)
			const templateUris = new Map<string, Uri>();
			const reservedUris = new Set<string>(); // Track allocated URIs for duplicates
			for (const template of missingTemplates) {
				const uri = await makeUniqueUri(folderUri, template.name, reservedUris);
				templateUris.set(template.id, uri);
				reservedUris.add(uri.toString());
			}

			// Phase 2: Fetch full templates with body (in chunks)
			const fullTemplates = new Map<string, FullTemplateFragment>();
			for (let i = 0; i < missingTemplates.length; i += CHUNK_SIZE) {
				const chunk = missingTemplates.slice(i, i + CHUNK_SIZE);
				const results = await Promise.all(
					chunk.map(async t => {
						try {
							const full = await session.getTemplate(t.id);
							return { id: t.id, template: full };
						} catch (err) {
							log.warn(`fetchFolder: failed to fetch template "${t.name}": ${err}`);
							return null;
						}
					}),
				);
				results.forEach(r => {
					if (r) fullTemplates.set(r.id, r.template);
				});
			}

			// Phase 3: Write files in chunks
			const idsToProcess = Array.from(fullTemplates.keys());

			for (let i = 0; i < idsToProcess.length; i += CHUNK_SIZE) {
				const chunkIds = idsToProcess.slice(i, i + CHUNK_SIZE);
				const results = await Promise.all(
					chunkIds.map(async id => {
						const template = fullTemplates.get(id)!;
						const uri = templateUris.get(id)!;
						try {
							const body = template.body;
							await writeTextFile(uri, body);
							log.trace('fetchFolder: file written', uri.fsPath);

							template.body = '';
							const templateLink = buildTemplateLink(template, body, uri.toString());

							LinkManager.addLink(templateLink); // Batched - no immediate save
							return true;
						} catch (err) {
							log.warn(`fetchFolder: failed to create file for "${template.name}": ${err}`);
							return false;
						}
					}),
				);
				successCount += results.filter(Boolean).length;
			}
		} finally {
			// Single save + event emission
			await LinkManager.endBatch();
		}

		log.trace('fetchFolder: completed');
		const message =
			successCount === missingTemplates.length
				? `SUCCESS: Fetched ${successCount} templates into the folder`
				: `Fetched ${successCount}/${missingTemplates.length} templates into the folder`;
		log.notifyInfo(message);
	}
})();
