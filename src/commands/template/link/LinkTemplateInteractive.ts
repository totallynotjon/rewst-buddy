import { LinkManager, SyncManager, TemplateLink } from '@models';
import { pickTemplate } from '@ui';
import { ensureSavedDocument, log, requireUnlinked } from '@utils';
import GenericCommand from '../../GenericCommand';

export class LinkTemplateInteractive extends GenericCommand {
	commandName = 'LinkTemplateInteractive';

	async execute(...args: unknown[]): Promise<void> {
		log.trace('LinkTemplateInteractive: starting');

		const document = await ensureSavedDocument(args);
		requireUnlinked(document.uri);

		const templatePick = await pickTemplate();
		if (!templatePick) {
			log.trace('LinkTemplateInteractive: no template selected, cancelled');
			return;
		}

		log.debug('LinkTemplateInteractive: fetching template', { templateId: templatePick.template.id });
		const template = await templatePick.session.getTemplate(templatePick.template.id);
		template.body = document.getText();
		template.updatedAt = '0';

		const templateLink: TemplateLink = {
			type: 'Template',
			template: template,
			uriString: document.uri.toString(),
			org: {
				id: template.orgId,
				name: template.organization.name,
			},
		};

		log.trace('LinkTemplateInteractive: adding link and syncing');
		await LinkManager.addLink(templateLink);
		await SyncManager.syncTemplate(document);

		log.notifyInfo('SUCCESS: Linked template');
	}
}
