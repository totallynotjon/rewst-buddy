import { LinkManager, TemplateLink } from '@models';
import { pickOrganization } from '@ui';
import { ensureSavedDocument, log, requireUnlinked } from '@utils';
import path from 'path';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class CreateTemplate extends GenericCommand {
	commandName = 'CreateTemplate';

	async execute(...args: unknown[]): Promise<void> {
		log.trace('CreateTemplate: starting');

		const document = await ensureSavedDocument(args);
		requireUnlinked(document.uri);

		const pick = await pickOrganization();
		if (!pick) {
			log.trace('CreateTemplate: no org selected, cancelled');
			return;
		}

		const { org, session } = pick;
		log.debug('CreateTemplate: org selected', { orgName: org.name, orgId: org.id });

		const suggestedName = path.basename(document.fileName, path.extname(document.fileName));
		const name = await vscode.window.showInputBox({
			prompt: 'Template name',
			value: suggestedName,
		});

		if (!name) {
			log.trace('CreateTemplate: no name entered, cancelled');
			return;
		}

		const body = document.getText();
		log.debug('CreateTemplate: creating template', { name, bodyLength: body.length });

		const response = await session.sdk?.createTemplateMinimal({
			name: name,
			orgId: org.id,
			body: body,
		});

		if (typeof response?.template?.id !== 'string') {
			throw log.notifyError('CreateTemplate: failed');
		}

		log.debug('CreateTemplate: template created', { templateId: response.template.id });

		// now we link the template now that it has been created
		const templateLink: TemplateLink = {
			type: 'Template',
			template: response.template,
			uriString: document.uri.toString(),
			org: org,
		};

		await LinkManager.addLink(templateLink).save();

		log.notifyInfo(`SUCCESS: Created template "${response.template.name}"`);
	}
}
