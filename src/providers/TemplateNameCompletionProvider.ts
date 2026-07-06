import { LinkManager, TemplateMetadataStore } from '@models';
import vscode from 'vscode';
import { isInsideTemplateCallPrefix } from './templatePatternUtils';

export class TemplateNameCompletionProvider implements vscode.CompletionItemProvider {
	provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
		_context: vscode.CompletionContext,
	): vscode.ProviderResult<vscode.CompletionItem[]> {
		if (!LinkManager.isLinked(document.uri)) return undefined;

		const line = document.lineAt(position.line).text;
		if (!isInsideTemplateCallPrefix(line, position.character)) return undefined;

		const link = LinkManager.getTemplateLink(document.uri);
		const templates = TemplateMetadataStore.getTemplatesForOrg(link.org.id);

		return templates.map(template => {
			const item = new vscode.CompletionItem(template.name, vscode.CompletionItemKind.Reference);
			item.insertText = template.id;
			item.filterText = template.name;
			item.detail = template.id;
			return item;
		});
	}
}
