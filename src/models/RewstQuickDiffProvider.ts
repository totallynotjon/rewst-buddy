import { SessionManager } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { LinkManager } from './LinkManager';
import { RewstContentProvider } from './RewstContentProvider';

const DEFAULT_TTL_MS = 30_000;

interface CacheEntry {
	body: string;
	fetchedAt: number;
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
	private ttlMs = DEFAULT_TTL_MS;

	init(): this {
		this.sourceControl = vscode.scm.createSourceControl('rewst-buddy-quick-diff', 'Rewst Buddy');
		this.sourceControl.quickDiffProvider = {
			provideOriginalResource: uri => this.provideOriginalResource(uri),
		};
		return this;
	}

	async provideOriginalResource(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
		if (!LinkManager.isLinked(uri)) return undefined;

		const key = uri.toString();
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
			return RewstContentProvider.put(uri, cached.body);
		}

		const link = LinkManager.getTemplateLink(uri);
		try {
			const session = await SessionManager.getSessionForOrg(link.org.id);
			const template = await session.getTemplate(link.template.id);
			this.cache.set(key, { body: template.body, fetchedAt: Date.now() });
			return RewstContentProvider.put(uri, template.body);
		} catch (error) {
			if (cached) {
				log.debug(`RewstQuickDiffProvider: refetch failed for ${uri.fsPath}, using stale cache: ${error}`);
				return RewstContentProvider.put(uri, cached.body);
			}
			log.debug(`RewstQuickDiffProvider: fetch failed for ${uri.fsPath}: ${error}`);
			return undefined;
		}
	}

	dispose(): void {
		this.sourceControl?.dispose();
		this.sourceControl = undefined;
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
