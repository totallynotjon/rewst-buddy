import { TemplateLinkManager } from '@models';
import { pickTemplate } from '@ui';
import { ensureSavedDocument, log, requireUnlinked } from '@utils';
import GenericCommand from '../../GenericCommand';

export class LinkTemplateInteractive extends GenericCommand {
	commandName = 'LinkTemplateInteractive';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);
		requireUnlinked(document.uri);

		const templatePick = await pickTemplate();
		if (!templatePick) return;

		const template = await templatePick.session.getTemplate(templatePick.template.id);
		template.body = document.getText();
		template.updatedAt = '0';

		await TemplateLinkManager.addLink({
			sessionProfile: templatePick.session.profile,
			template: template,
			uriString: document.uri.toString(),
		}).save();

		log.notifyInfo('SUCCESS: Linked template');
	}
}
