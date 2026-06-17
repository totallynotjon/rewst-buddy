import vscode from 'vscode';
import { onDidChangeContextUsage, type ContextUsage } from './chat/model/contextUsage';

/** Compact token count for the status bar: 950, 16K, 60.5K, 144K. */
export function formatTokenCount(count: number): string {
	if (count < 1000) return String(Math.round(count));
	const thousands = count / 1000;
	const value = thousands >= 100 ? Math.round(thousands) : Number(thousands.toFixed(1));
	return `${value}K`;
}

export function statusBarText(usage: ContextUsage): string {
	return `$(dashboard) ${Math.round(usage.percent)}%`;
}

export function statusBarTooltip(usage: ContextUsage): vscode.MarkdownString {
	const org = usage.orgName ? ` · ${usage.orgName}` : '';
	return new vscode.MarkdownString(
		`**Cage-Free Rewsty context window**${org}\n\n` +
			`${formatTokenCount(usage.totalTokens)} / ${formatTokenCount(usage.maxTokens)} tokens · ${Math.round(usage.percent)}% used`,
	);
}

/**
 * Bottom-right indicator for the context-window usage the Rewst backend reports
 * each turn. VS Code's native chat gauge stays at 0 for a third-party model
 * provider (microsoft/vscode#309207, #313458), so this stands in for it: hidden
 * until a turn reports usage, then showing the most recent turn's usage.
 */
export class ContextUsageStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly subscription: vscode.Disposable;

	constructor() {
		this.item = vscode.window.createStatusBarItem('rewst-buddy.contextUsage', vscode.StatusBarAlignment.Right, 100);
		this.item.name = 'Cage-Free Rewsty Context';
		this.subscription = onDidChangeContextUsage(usage => this.render(usage));
	}

	private render(usage: ContextUsage): void {
		this.item.text = statusBarText(usage);
		this.item.tooltip = statusBarTooltip(usage);
		this.item.show();
	}

	dispose(): void {
		this.subscription.dispose();
		this.item.dispose();
	}
}
