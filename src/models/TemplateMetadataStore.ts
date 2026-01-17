import type { SessionChangeEvent } from '@events';
import { SessionManager, TemplateFragment } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { Org } from './types';

export interface TemplateMetadata {
	template: TemplateFragment;
	org: Org;
}

export const TemplateMetadataStore = new (class _ implements vscode.Disposable {
	private templateIndex = new Map<string, TemplateMetadata>();
	private orgIndex = new Map<string, Set<string>>();
	private disposables: vscode.Disposable[] = [];
	private loading = false;

	init(): _ {
		this.disposables.push(SessionManager.onSessionChange(e => this.handleSessionChange(e)));
		// Load templates for any existing sessions
		this.loadAllSessionTemplates();
		return this;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.templateIndex.clear();
		this.orgIndex.clear();
	}

	getTemplateMetadata(templateId: string): TemplateMetadata | undefined {
		return this.templateIndex.get(templateId);
	}

	private handleSessionChange(event: SessionChangeEvent): void {
		if (event.type === 'saved') {
			this.loadAllSessionTemplates();
		} else if (event.type === 'cleared') {
			this.clearAll();
		}
	}

	private clearAll(): void {
		log.debug('TemplateMetadataStore: clearing all metadata');
		this.templateIndex.clear();
		this.orgIndex.clear();
	}

	private async loadAllSessionTemplates(): Promise<void> {
		if (this.loading) {
			log.trace('TemplateMetadataStore: already loading, skipping');
			return;
		}

		this.loading = true;
		try {
			const sessions = SessionManager.getActiveSessions();
			if (sessions.length === 0) {
				log.trace('TemplateMetadataStore: no active sessions');
				return;
			}

			log.debug('TemplateMetadataStore: loading templates for sessions', sessions.length);

			// Collect all orgs from all sessions (including managed orgs)
			const orgSessionMap = new Map<string, { org: Org; session: (typeof sessions)[0] }>();
			for (const session of sessions) {
				for (const org of session.profile.allManagedOrgs) {
					if (!orgSessionMap.has(org.id)) {
						orgSessionMap.set(org.id, { org, session });
					}
				}
			}

			// Load templates in parallel with chunking (5 concurrent requests)
			const orgs = Array.from(orgSessionMap.values());
			const chunkSize = 5;

			for (let i = 0; i < orgs.length; i += chunkSize) {
				const chunk = orgs.slice(i, i + chunkSize);
				await Promise.all(chunk.map(({ org, session }) => this.loadOrgTemplates(org, session)));
			}

			log.debug('TemplateMetadataStore: loaded templates', {
				templateCount: this.templateIndex.size,
				orgCount: this.orgIndex.size,
			});
		} catch (error) {
			log.error('TemplateMetadataStore: failed to load templates', error);
		} finally {
			this.loading = false;
		}
	}

	private async loadOrgTemplates(
		org: Org,
		session: ReturnType<typeof SessionManager.getActiveSessions>[0],
	): Promise<void> {
		try {
			log.trace('TemplateMetadataStore: loading templates for org', org.name);
			const response = await session.sdk?.listTemplates({ orgId: org.id });

			if (!response?.templates) {
				log.trace('TemplateMetadataStore: no templates found for org', org.name);
				return;
			}

			// Clear existing templates for this org before adding new ones
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
})();
