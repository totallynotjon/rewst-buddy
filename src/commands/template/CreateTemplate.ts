import { TemplateLinkManager } from '@models';
import { pickOrganization } from '@ui';
import { ensureSavedDocument, log, requireUnlinked } from '@utils';
import path from 'path';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class CreateTemplate extends GenericCommand {
	commandName = 'CreateTemplate';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);
		requireUnlinked(document.uri);

		const pick = await pickOrganization();
		if (!pick) return;

		const { org, session } = pick;

		const suggestedName = path.basename(document.fileName, path.extname(document.fileName));
		const name = await vscode.window.showInputBox({
			prompt: 'Template name',
			value: suggestedName,
		});

		if (!name) return;

		const body = document.getText();

		const response = await session.sdk?.createTemplateMinimal({
			name: name,
			orgId: org.id,
			body: body,
		});

		if (typeof response?.template?.id !== 'string') {
			throw log.notifyError(`Failed to create template`);
		}

		// now we link the template now that it has been created
		await TemplateLinkManager.addLink({
			sessionProfile: session.profile,
			template: response.template,
			uriString: document.uri.toString(),
		}).save();

		log.notifyInfo(`SUCCESS: Created template "${response.template.name}"`);
	}
}
