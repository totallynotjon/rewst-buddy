import { LinkManager } from '@models';
import { SessionManager } from '@sessions';
import vscode from 'vscode';
import {
	engineBaseFromRegion,
	getCachedFilters,
	primeFilters,
	type JinjaFilterDoc,
} from '../capabilities/jinjaDocsCapabilities';
import { findJinjaFilterNameAtPosition, findJinjaFilterTriggerAtPosition } from './jinjaPatternUtils';

/** Resolves the engine base for an already-linked document, via its org's active session. Sync — no fetches. */
function engineBaseForLinkedDocument(uri: vscode.Uri): string | undefined {
	const link = LinkManager.getTemplateLink(uri);
	const session = SessionManager.getActiveSessions().find(s =>
		s.profile.allManagedOrgs.some(org => org.id === link.org.id),
	);
	return session ? engineBaseFromRegion(session.profile.region?.graphqlUrl) : undefined;
}

function displayName(filter: JinjaFilterDoc): string {
	return filter.signature ? `${filter.name}${filter.signature}` : filter.name;
}

function toCompletionItem(filter: JinjaFilterDoc): vscode.CompletionItem {
	const item = new vscode.CompletionItem(filter.name, vscode.CompletionItemKind.Function);
	item.insertText = filter.name;
	item.detail = displayName(filter);
	item.documentation = new vscode.MarkdownString(filter.documentation);
	return item;
}

/** Cache-only lookup for a linked document's filter catalog; primes on a miss, never fetches. */
function resolveCachedFilters(uri: vscode.Uri): JinjaFilterDoc[] | undefined {
	const base = engineBaseForLinkedDocument(uri);
	if (!base) return undefined;

	const cached = getCachedFilters(base);
	if (!cached) {
		primeFilters(base);
		return undefined;
	}
	return cached;
}

export class JinjaFilterProvider implements vscode.HoverProvider, vscode.CompletionItemProvider {
	provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.Hover> {
		if (!LinkManager.isLinked(document.uri)) return undefined;

		const line = document.lineAt(position.line).text;
		const name = findJinjaFilterNameAtPosition(line, position.character);
		if (!name) return undefined;

		const cached = resolveCachedFilters(document.uri);
		if (!cached) return undefined;

		const filter = cached.find(f => f.name === name);
		if (!filter) return undefined;

		const content = new vscode.MarkdownString();
		content.appendMarkdown(`**${displayName(filter)}**\n\n`);
		content.appendMarkdown(filter.documentation);
		return new vscode.Hover(content);
	}

	provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
		_context: vscode.CompletionContext,
	): vscode.ProviderResult<vscode.CompletionItem[]> {
		if (!LinkManager.isLinked(document.uri)) return undefined;

		const line = document.lineAt(position.line).text;
		const trigger = findJinjaFilterTriggerAtPosition(line, position.character);
		if (!trigger) return undefined;

		const cached = resolveCachedFilters(document.uri);
		if (!cached) return undefined;

		return cached.map(toCompletionItem);
	}
}
