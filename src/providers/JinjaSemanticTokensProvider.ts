import { LinkManager } from '@models';
import vscode from 'vscode';
import { findJinjaKeywordTokens } from './jinjaPatternUtils';

export const JINJA_SEMANTIC_TOKENS_LEGEND = new vscode.SemanticTokensLegend(['keyword']);

export class JinjaSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	provideDocumentSemanticTokens(
		document: vscode.TextDocument,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.SemanticTokens> {
		if (!LinkManager.isLinked(document.uri)) return undefined;

		const builder = new vscode.SemanticTokensBuilder(JINJA_SEMANTIC_TOKENS_LEGEND);
		for (let line = 0; line < document.lineCount; line++) {
			const text = document.lineAt(line).text;
			for (const keyword of findJinjaKeywordTokens(text)) {
				builder.push(line, keyword.start, keyword.end - keyword.start, 0, 0);
			}
		}
		return builder.build();
	}
}
