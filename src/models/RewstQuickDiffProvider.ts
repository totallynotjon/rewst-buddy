import { SessionManager } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { LinkManager } from './LinkManager';
import { RewstContentProvider } from './RewstContentProvider';
import type { Link, TemplateLink } from './types';

const DEFAULT_TTL_MS = 30_000;

interface CacheEntry {
	body: string;
	fetchedAt: number;
	remoteUri: vscode.Uri;
	templateId: string;
}

/**
 * Best-effort quick-diff support for linked files: resolves the remote
 * template body as the "original resource" so linked-file editors can gain
 * gutter change indicators against the remote baseline, where VS Code's
 * decorations pipeline honors a non-primary SourceControl. A short-lived TTL
 * cache avoids re-fetching on every decorations-pipeline poll.
 */
export const RewstQuickDiffProvider = new (class RewstQuickDiffProvider implements vscode.Disposable {
	private cache = new Map<string, CacheEntry>();
	private sourceControl: vscode.SourceControl | undefined;
	private linksSavedSub: vscode.Disposable | undefined;
	private ttlMs = DEFAULT_TTL_MS;

	init(): this {
		this.sourceControl = vscode.scm.createSourceControl('rewst-buddy-quick-diff', 'Rewst Buddy');
		this.sourceControl.quickDiffProvider = {
			provideOriginalResource: uri => this.provideOriginalResource(uri),
		};
		this.linksSavedSub = LinkManager.onLinksSaved(({ links }) => this.evictStaleCacheEntries(links));
		return this;
	}

	/**
	 * A cache entry keyed by uri can go stale without the TTL elapsing: the file
	 * gets unlinked (handled by `isLinked` already, but the entry itself would
	 * otherwise leak forever), or relinked to a different template at the same
	 * uri — in which case the previous template's body must not keep being
	 * served as the "original resource" until the TTL happens to expire.
	 */
	private evictStaleCacheEntries(links: Link[]): void {
		const currentTemplateIdByUri = new Map<string, string>();
		for (const link of links) {
			if (link.type === 'Template')
				currentTemplateIdByUri.set(link.uriString, (link as TemplateLink).template.id);
		}
		for (const [key, entry] of this.cache) {
			if (currentTemplateIdByUri.get(key) !== entry.templateId) {
				RewstContentProvider.remove(entry.remoteUri);
				this.cache.delete(key);
			}
		}
	}

	async provideOriginalResource(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
		if (!LinkManager.isLinked(uri)) return undefined;

		const key = uri.toString();
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
			return cached.remoteUri;
		}

		const link = LinkManager.getTemplateLink(uri);
		try {
			const session = await SessionManager.getSessionForOrg(link.org.id);
			const template = await session.getTemplate(link.template.id);
			// Reuse a single rewst-remote uri per source uri: put() always
			// allocates a fresh one, and the decorations pipeline polls this
			// method far more often than any editor actually opens/closes the
			// result, so a naive put()-per-call would grow RewstContentProvider's
			// content map without bound.
			if (cached) RewstContentProvider.remove(cached.remoteUri);
			const remoteUri = RewstContentProvider.put(uri, template.body);
			this.cache.set(key, {
				body: template.body,
				fetchedAt: Date.now(),
				remoteUri,
				templateId: link.template.id,
			});
			return remoteUri;
		} catch (error) {
			if (cached) {
				log.debug(`RewstQuickDiffProvider: refetch failed for ${uri.fsPath}, using stale cache: ${error}`);
				return cached.remoteUri;
			}
			log.debug(`RewstQuickDiffProvider: fetch failed for ${uri.fsPath}: ${error}`);
			return undefined;
		}
	}

	dispose(): void {
		this.sourceControl?.dispose();
		this.sourceControl = undefined;
		this.linksSavedSub?.dispose();
		this.linksSavedSub = undefined;
		for (const entry of this.cache.values()) RewstContentProvider.remove(entry.remoteUri);
		this.cache.clear();
	}

	_setTtlForTesting(ms: number): void {
		this.ttlMs = ms;
	}

	_resetForTesting(): void {
		this.cache.clear();
		this.ttlMs = DEFAULT_TTL_MS;
	}
})();
