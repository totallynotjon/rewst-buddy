import { findAllTemplateReferences, log } from '@utils';
import vscode from 'vscode';
import { OrgBundles, TemplateBundle } from './bundleTypes';
import { LinkManager } from './LinkManager';
import { Org, TemplateLink } from './types';

export const TemplateBundleManager = new (class _ implements vscode.Disposable {
	private orgBundlesCache: OrgBundles[] = [];
	private disposables: vscode.Disposable[] = [];
	private building = false;
	private pendingRebuild = false;
	private debounceTimer: NodeJS.Timeout | undefined;

	private lastError: string | undefined;

	private readonly bundlesChangedEmitter = new vscode.EventEmitter<void>();
	readonly onBundlesChanged = this.bundlesChangedEmitter.event;

	init(): _ {
		this.disposables.push(LinkManager.onLinksSaved(() => this.debouncedBuild()));
		// Build with whatever links exist already
		this.buildBundles();
		return this;
	}

	dispose(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.disposables.forEach(d => d.dispose());
		this.bundlesChangedEmitter.dispose();
		this.orgBundlesCache = [];
	}

	getOrgBundles(): OrgBundles[] {
		return this.orgBundlesCache;
	}

	getError(): string | undefined {
		return this.lastError;
	}

	_resetForTesting(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = undefined;
		this.orgBundlesCache = [];
		this.building = false;
		this.pendingRebuild = false;
		this.lastError = undefined;
	}

	private debouncedBuild(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => this.buildBundles(), 2000);
	}

	async buildBundles(): Promise<void> {
		if (this.building) {
			this.pendingRebuild = true;
			return;
		}

		this.building = true;
		try {
			const allLinks = LinkManager.getAllTemplateLinks();

			// Backfill links that were persisted before referencedTemplateIds existed
			const unscanned = allLinks.filter(l => l.referencedTemplateIds === undefined);
			if (unscanned.length > 0) {
				await Promise.all(
					unscanned.map(async link => {
						try {
							const uri = vscode.Uri.parse(link.uriString);
							const content = await vscode.workspace.fs.readFile(uri);
							link.referencedTemplateIds = findAllTemplateReferences(
								Buffer.from(content).toString('utf-8'),
							);
						} catch {
							link.referencedTemplateIds = [];
						}
					}),
				);
				await LinkManager.save();
			}

			if (allLinks.length === 0) {
				this.orgBundlesCache = [];
				this.bundlesChangedEmitter.fire();
				return;
			}

			// Group by org
			const orgMap = new Map<string, { org: Org; links: TemplateLink[] }>();
			for (const link of allLinks) {
				const existing = orgMap.get(link.org.id);
				if (existing) {
					existing.links.push(link);
				} else {
					orgMap.set(link.org.id, { org: link.org, links: [link] });
				}
			}

			const results: OrgBundles[] = [];
			for (const { org, links } of orgMap.values()) {
				results.push(this.buildOrgBundles(org, links));
			}

			this.orgBundlesCache = results;
			this.lastError = undefined;
			this.bundlesChangedEmitter.fire();
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			log.warn('TemplateBundleManager: failed to build bundles', error);
			this.bundlesChangedEmitter.fire();
		} finally {
			this.building = false;
			if (this.pendingRebuild) {
				this.pendingRebuild = false;
				this.debouncedBuild();
			}
		}
	}

	private buildOrgBundles(org: Org, links: TemplateLink[]): OrgBundles {
		const linkById = new Map<string, TemplateLink>();
		for (const link of links) linkById.set(link.template.id, link);

		const outgoing = new Map<string, Set<string>>();
		const referenced = new Set<string>();

		for (const link of links) {
			const id = link.template.id;
			const refs = new Set<string>();
			for (const refId of link.referencedTemplateIds ?? []) {
				if (linkById.has(refId)) {
					refs.add(refId);
					referenced.add(refId);
				}
			}
			outgoing.set(id, refs);
		}

		const collectDescendants = (startId: string, globalVisited?: Set<string>): string[] => {
			const visited = new Set<string>();
			const members: string[] = [];
			const stack = [startId];
			while (stack.length > 0) {
				const current = stack.pop()!;
				if (visited.has(current)) continue;
				visited.add(current);
				globalVisited?.add(current);
				members.push(current);
				for (const ref of outgoing.get(current) ?? []) {
					if (!visited.has(ref)) stack.push(ref);
				}
			}
			return members;
		};

		const makeBundle = (rootId: string, memberIds: string[]): TemplateBundle | undefined => {
			const rootLink = linkById.get(rootId);
			if (!rootLink) return undefined;
			return {
				id: rootId,
				displayName: rootLink.template.name,
				root: rootLink,
				members: memberIds.map(id => linkById.get(id)).filter((l): l is TemplateLink => l !== undefined),
			};
		};

		const bundles: TemplateBundle[] = [];

		// Roots: outgoing refs but not referenced by anything
		const roots = new Set<string>();
		for (const [id, refs] of outgoing) {
			if (refs.size > 0 && !referenced.has(id)) roots.add(id);
		}

		const covered = new Set<string>();
		for (const rootId of roots) {
			const memberIds = collectDescendants(rootId);
			const bundle = makeBundle(rootId, memberIds);
			if (bundle) bundles.push(bundle);
			for (const id of memberIds) covered.add(id);
		}

		// Cycles: remaining nodes with outgoing refs not yet reached from a root
		const cycleVisited = new Set(covered);
		for (const [id, refs] of outgoing) {
			if (refs.size === 0 || cycleVisited.has(id)) continue;
			const bundle = makeBundle(id, collectDescendants(id, cycleVisited));
			if (bundle) bundles.push(bundle);
		}

		const nameCount = new Map<string, number>();
		for (const b of bundles) nameCount.set(b.displayName, (nameCount.get(b.displayName) ?? 0) + 1);
		for (const b of bundles) {
			if ((nameCount.get(b.displayName) ?? 0) > 1) {
				b.displayName = `${b.displayName} (${b.id.slice(0, 8)})`;
			}
		}
		bundles.sort((a, b) => a.displayName.localeCompare(b.displayName));

		const standalone = links
			.filter(l => outgoing.get(l.template.id)!.size === 0 && !referenced.has(l.template.id))
			.sort((a, b) => a.template.name.localeCompare(b.template.name));

		return { org, bundles, standalone };
	}
})();
