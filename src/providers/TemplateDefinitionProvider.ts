import { LinkManager } from '@models';
import vscode from 'vscode';
import { findTemplateAtPosition } from './templatePatternUtils';

export class TemplateDefinitionProvider implements vscode.DefinitionProvider {
	provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
		// Only for linked templates
		if (!LinkManager.isLinked(document.uri)) {
			return;
		}

		// Get the line text and find template({{guid}}) pattern at cursor
		const line = document.lineAt(position.line).text;
		const match = findTemplateAtPosition(line, position.character);

		if (!match) {
			return;
		}

		// Check if referenced template is linked locally
		const linkedTemplates = LinkManager.getTemplateLinkFromId(match.templateId);

		if (linkedTemplates.length === 0) {
			return; // Not linked locally - no definition available
		}

		// Return LocationLink with origin selection range for full pattern highlighting
		const targetUri = vscode.Uri.parse(linkedTemplates[0].uriString);
		const originRange = new vscode.Range(position.line, match.startChar, position.line, match.endChar);

		return [
			{
				originSelectionRange: originRange,
				targetUri,
				targetRange: new vscode.Range(0, 0, 0, 0),
			},
		];
	}
}
