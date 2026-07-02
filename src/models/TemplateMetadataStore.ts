import type { SessionChangeEvent } from '@events';
import { SessionManager, TemplateFragment } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { LinkManager } from './LinkManager';
import { Org } from './types';

export interface TemplateMetadata {
	template: TemplateFragment;
	org: Org;
}

interface OrgSession {
	org: Org;
	session: ReturnType<typeof SessionManager.getActiveSessions>[0];
}

const DEFERRED_DELAY_STARTUP_MS = 30_000;
const DEFERRED_DELAY_SESSION_EVENT_MS = 5_000;

export const TemplateMetadataStore = new (class _ implements vscode.Disposable {
	private templateIndex = new Map<string, TemplateMetadata>();
	private orgIndex = new Map<string, Set<string>>();
	private disposables: vscode.Disposable[] = [];
	private loading = false;
	private pendingReload = false;
	private loadGeneration = 0;
	private deferredTimer: ReturnType<typeof setTimeout> | undefined;
	private deferredDelayOverride: number | undefined;

	init(): _ {
		this.disposables.push(SessionManager.onSessionChange(e => this.handleSessionChange(e)));
		this.loadAllSessionTemplates(DEFERRED_DELAY_STARTUP_MS);
		return this;
	}

	dispose(): void {
		this.loadGeneration++;
		this.clearDeferredTimer();
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
		this.templateIndex.clear();
		this.orgIndex.clear();
		this.loading = false;
		this.pendingReload = false;
	}

	getTemplateMetadata(templateId: string): TemplateMetadata | undefined {
		return this.templateIndex.get(templateId);
	}

	private handleSessionChange(event: SessionChangeEvent): void {
		if (event.type === 'saved') {
			this.loadAllSessionTemplates(DEFERRED_DELAY_SESSION_EVENT_MS);
		} else if (event.type === 'removed') {
			// Invalidate any load already in flight first: it may still hold the
			// removed session and would re-insert its orgs' metadata after the
			// prune below (its generation checks would still pass).
			this.loadGeneration++;
			this.clearDeferredTimer();
			// Drop metadata for orgs no remaining session manages so hovers and
			// definitions cannot offer templates whose session is gone, then
			// reload: an org the removed session shared with a survivor stays.
			this.pruneOrgsWithoutSession();
			this.loadAllSessionTemplates(DEFERRED_DELAY_SESSION_EVENT_MS);
		} else if (event.type === 'cleared') {
			this.clearAll();
		}
	}

	private pruneOrgsWithoutSession(): void {
		const covered = this.collectOrgSessionMap();
		for (const orgId of Array.from(this.orgIndex.keys())) {
			if (!covered.has(orgId)) {
				this.clearOrgTemplates(orgId);
			}
		}
	}

	private clearAll(): void {
		log.debug('TemplateMetadataStore: clearing all metadata');
		this.loadGeneration++;
		this.clearDeferredTimer();
		this.templateIndex.clear();
		this.orgIndex.clear();
	}

	private clearDeferredTimer(): void {
		if (this.deferredTimer !== undefined) {
			clearTimeout(this.deferredTimer);
			this.deferredTimer = undefined;
		}
	}

	private collectOrgSessionMap(): Map<string, OrgSession> {
		const sessions = SessionManager.getActiveSessions();
		const orgSessionMap = new Map<string, OrgSession>();
		for (const session of sessions) {
			for (const org of session.profile.allManagedOrgs) {
				if (!orgSessionMap.has(org.id)) {
					orgSessionMap.set(org.id, { org, session });
				}
			}
		}
		return orgSessionMap;
	}

	private async loadAllSessionTemplates(deferredDelayMs: number): Promise<void> {
		if (this.loading) {
			this.pendingReload = true;
			log.trace('TemplateMetadataStore: already loading, will reload after');
			return;
		}

		this.loading = true;
		const generation = ++this.loadGeneration;
		this.clearDeferredTimer();

		try {
			const orgSessionMap = this.collectOrgSessionMap();
			if (orgSessionMap.size === 0) {
				log.trace('TemplateMetadataStore: no active sessions');
				return;
			}

			const linkedOrgIds = new Set(LinkManager.getAllTemplateLinks().map(l => l.org.id));

			const priorityOrgs: OrgSession[] = [];
			const deferredOrgs: OrgSession[] = [];

			for (const entry of orgSessionMap.values()) {
				if (linkedOrgIds.has(entry.org.id)) {
					priorityOrgs.push(entry);
				} else {
					deferredOrgs.push(entry);
				}
			}

			log.debug('TemplateMetadataStore: loading templates', {
				priority: priorityOrgs.length,
				deferred: deferredOrgs.length,
			});

			await this.loadOrgChunks(priorityOrgs, generation);

			if (generation !== this.loadGeneration) return;

			if (deferredOrgs.length > 0) {
				const delay = this.deferredDelayOverride ?? deferredDelayMs;
				this.deferredTimer = setTimeout(() => {
					this.deferredTimer = undefined;
					if (generation !== this.loadGeneration) return;
					this.loadOrgChunks(deferredOrgs, generation)
						.then(() => {
							log.debug('TemplateMetadataStore: deferred load complete', {
								templateCount: this.templateIndex.size,
								orgCount: this.orgIndex.size,
							});
						})
						.catch(error => {
							log.error('TemplateMetadataStore: deferred load failed', error);
						});
				}, delay);
			}

			log.debug('TemplateMetadataStore: priority load complete', {
				templateCount: this.templateIndex.size,
				orgCount: this.orgIndex.size,
			});
		} catch (error) {
			log.error('TemplateMetadataStore: failed to load templates', error);
		} finally {
			this.loading = false;
			if (this.pendingReload) {
				this.pendingReload = false;
				this.loadAllSessionTemplates(DEFERRED_DELAY_SESSION_EVENT_MS);
			}
		}
	}

	private async loadOrgChunks(orgs: OrgSession[], generation: number): Promise<void> {
		const chunkSize = 5;
		for (let i = 0; i < orgs.length; i += chunkSize) {
			if (generation !== this.loadGeneration) return;
			const chunk = orgs.slice(i, i + chunkSize);
			await Promise.all(chunk.map(({ org, session }) => this.loadOrgTemplates(org, session, generation)));
		}
	}

	private async loadOrgTemplates(
		org: Org,
		session: ReturnType<typeof SessionManager.getActiveSessions>[0],
		generation: number,
	): Promise<void> {
		try {
			if (!session.sdk) {
				log.warn('TemplateMetadataStore: no SDK available for org', org.name);
				return;
			}
			log.trace('TemplateMetadataStore: loading templates for org', org.name);
			const response = await session.sdk.listTemplates({ orgId: org.id });

			if (generation !== this.loadGeneration) return;

			if (!response?.templates) {
				log.trace('TemplateMetadataStore: no templates found for org', org.name);
				return;
			}

			this.clearOrgTemplates(org.id);

			const templateIds = new Set<string>();
			for (const template of response.templates) {
				this.templateIndex.set(template.id, { template, org });
				templateIds.add(template.id);
			}
			this.orgIndex.set(org.id, templateIds);

			log.trace('TemplateMetadataStore: loaded templates for org', {
				orgName: org.name,
				count: response.templates.length,
			});
		} catch (error) {
			log.error(`TemplateMetadataStore: failed to load templates for org ${org.name}`, error);
		}
	}

	private clearOrgTemplates(orgId: string): void {
		const templateIds = this.orgIndex.get(orgId);
		if (templateIds) {
			for (const id of templateIds) {
				this.templateIndex.delete(id);
			}
			this.orgIndex.delete(orgId);
		}
	}

	_setDeferredDelayForTesting(ms: number): void {
		this.deferredDelayOverride = ms;
	}

	_resetForTesting(): void {
		this.clearDeferredTimer();
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
		this.templateIndex.clear();
		this.orgIndex.clear();
		this.loading = false;
		this.pendingReload = false;
		this.loadGeneration++;
		this.deferredDelayOverride = undefined;
	}
})();
