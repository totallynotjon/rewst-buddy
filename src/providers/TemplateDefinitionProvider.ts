import { LinkManager, TemplateMetadata, TemplateMetadataStore } from '@models';
import { SessionManager } from '@sessions';
import { createAndLinkNewTemplate, log } from '@utils';
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
		const originRange = new vscode.Range(position.line, match.startChar, position.line, match.endChar);

		if (linkedTemplates.length === 0) {
			// Not linked locally - check global metadata store
			const metadata = TemplateMetadataStore.getTemplateMetadata(match.templateId);
			if (metadata) {
				// Trigger open flow for unlinked template (fire-and-forget)
				this.openUnlinkedTemplate(match.templateId, metadata);
			}
			return; // Return undefined - VS Code will handle the newly opened file
		}

		// Return LocationLink with origin selection range for full pattern highlighting
		const targetUri = vscode.Uri.parse(linkedTemplates[0].uriString);

		return [
			{
				originSelectionRange: originRange,
				targetUri,
				targetRange: new vscode.Range(0, 0, 0, 0),
			},
		];
	}

	private async openUnlinkedTemplate(templateId: string, metadata: TemplateMetadata): Promise<void> {
		try {
			const session = SessionManager.getSessionForOrg(metadata.org.id);
			const fullTemplate = await session.getTemplate(templateId);
			await createAndLinkNewTemplate(fullTemplate);
		} catch (error) {
			log.notifyError(`Failed to open template: ${error}`);
		}
	}
}
