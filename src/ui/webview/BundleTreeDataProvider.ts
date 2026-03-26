import { OrgBundles, TemplateBundleManager, TemplateBundle, TemplateLink } from '@models';
import vscode from 'vscode';

type BundleTreeNode = OrgNode | SectionNode | BundleNode | TemplateNode | ErrorNode;

class OrgNode {
	readonly kind = 'org' as const;
	constructor(public readonly orgBundles: OrgBundles) {}
}

class SectionNode {
	readonly kind = 'section' as const;
	constructor(
		public readonly label: string,
		public readonly orgBundles: OrgBundles,
		public readonly type: 'bundles' | 'standalone',
	) {}
}

class BundleNode {
	readonly kind = 'bundle' as const;
	constructor(public readonly bundle: TemplateBundle) {}
}

class TemplateNode {
	readonly kind = 'template' as const;
	readonly resourceUri: vscode.Uri;
	constructor(public readonly link: TemplateLink) {
		this.resourceUri = vscode.Uri.parse(link.uriString);
	}
}

class ErrorNode {
	readonly kind = 'error' as const;
	constructor(public readonly message: string) {}
}

export class BundleTreeDataProvider implements vscode.TreeDataProvider<BundleTreeNode>, vscode.Disposable {
	private changeEmitter = new vscode.EventEmitter<BundleTreeNode | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.disposables.push(TemplateBundleManager.onBundlesChanged(() => this.changeEmitter.fire()));
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.changeEmitter.dispose();
	}

	getTreeItem(element: BundleTreeNode): vscode.TreeItem {
		switch (element.kind) {
			case 'org': {
				const item = new vscode.TreeItem(
					element.orgBundles.org.name,
					vscode.TreeItemCollapsibleState.Collapsed,
				);
				item.iconPath = new vscode.ThemeIcon('organization');
				item.contextValue = 'bundleOrg';
				return item;
			}

			case 'section': {
				const count =
					element.type === 'bundles'
						? element.orgBundles.bundles.length
						: element.orgBundles.standalone.length;
				const item = new vscode.TreeItem(
					`${element.label} (${count})`,
					vscode.TreeItemCollapsibleState.Collapsed,
				);
				item.iconPath = new vscode.ThemeIcon(element.type === 'bundles' ? 'package' : 'file');
				item.contextValue = `bundleSection.${element.type}`;
				return item;
			}

			case 'bundle': {
				const item = new vscode.TreeItem(element.bundle.displayName, vscode.TreeItemCollapsibleState.Collapsed);
				item.iconPath = new vscode.ThemeIcon('package');
				item.description = `${element.bundle.members.length} templates`;
				item.tooltip = this.buildBundleTooltip(element.bundle);
				item.contextValue = 'bundle';
				return item;
			}

			case 'template': {
				const item = new vscode.TreeItem(element.link.template.name, vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon('file-code');
				item.resourceUri = element.resourceUri;
				item.command = {
					command: 'vscode.open',
					title: 'Open Template',
					arguments: [element.resourceUri],
				};
				item.tooltip = element.link.template.name;
				item.contextValue = 'bundleTemplate';
				return item;
			}

			case 'error': {
				const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon('error');
				item.contextValue = 'bundleError';
				return item;
			}
		}
	}

	getChildren(element?: BundleTreeNode): BundleTreeNode[] {
		if (!element) {
			const error = TemplateBundleManager.getError();
			if (error) {
				return [new ErrorNode(`Failed to build bundles: ${error}`)];
			}

			const orgBundles = TemplateBundleManager.getOrgBundles();
			if (orgBundles.length === 0) {
				return [];
			}
			// If only one org, skip the org level
			if (orgBundles.length === 1) {
				return this.getOrgChildren(orgBundles[0]);
			}
			return orgBundles.map(ob => new OrgNode(ob));
		}

		switch (element.kind) {
			case 'org':
				return this.getOrgChildren(element.orgBundles);

			case 'section':
				if (element.type === 'bundles') {
					return element.orgBundles.bundles.map(b => new BundleNode(b));
				}
				return element.orgBundles.standalone.map(l => new TemplateNode(l));

			case 'bundle':
				return element.bundle.members.map(l => new TemplateNode(l));

			case 'template':
			case 'error':
				return [];
		}
	}

	private getOrgChildren(orgBundles: OrgBundles): BundleTreeNode[] {
		const children: BundleTreeNode[] = [];
		if (orgBundles.bundles.length > 0) {
			children.push(new SectionNode('Bundles', orgBundles, 'bundles'));
		}
		if (orgBundles.standalone.length > 0) {
			children.push(new SectionNode('Standalone', orgBundles, 'standalone'));
		}
		return children;
	}

	private buildBundleTooltip(bundle: TemplateBundle): vscode.MarkdownString {
		const lines = [
			`**${bundle.displayName}**`,
			``,
			`**Root:** ${bundle.root.template.name}`,
			`**Templates:** ${bundle.members.length}`,
			``,
			...bundle.members.map(m =>
				m.template.id === bundle.root.template.id ? `- **${m.template.name}** (root)` : `- ${m.template.name}`,
			),
		];
		return new vscode.MarkdownString(lines.join('\n'));
	}
}
