import { LinkManager } from '@models';
import vscode from 'vscode';
import { findTemplateAtPosition } from './templatePatternUtils';

export class TemplateHoverProvider implements vscode.HoverProvider {
	provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.Hover> {
		// Only for linked templates
		if (!LinkManager.isLinked(document.uri)) {
			return;
		}

		const line = document.lineAt(position.line).text;
		const match = findTemplateAtPosition(line, position.character);

		if (!match) {
			return;
		}

		const hoverRange = new vscode.Range(position.line, match.startChar, position.line, match.endChar);

		const linkedTemplates = LinkManager.getTemplateLinkFromId(match.templateId);

		if (linkedTemplates.length === 0) {
			// Template not linked locally - show ID only
			const content = new vscode.MarkdownString();
			content.appendMarkdown(`**Template:** \`${match.templateId}\`\n\n`);
			content.appendMarkdown(`*Not linked locally*`);
			return new vscode.Hover(content, hoverRange);
		}

		const link = linkedTemplates[0];
		const content = new vscode.MarkdownString();
		content.appendMarkdown(`**Template:** ${link.template.name}\n\n`);
		content.appendMarkdown(`**Org:** ${link.org.name}`);
		return new vscode.Hover(content, hoverRange);
	}
}
