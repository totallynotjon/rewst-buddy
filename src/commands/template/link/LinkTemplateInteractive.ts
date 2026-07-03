import { pickTemplate } from '@ui';
import { ensureSavedDocument, log, requireUnlinked } from '@utils';
import GenericCommand from '../../GenericCommand';
import { linkDocumentToTemplate } from './linkDocumentToTemplate';

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

		await linkDocumentToTemplate(
			document,
			templatePick.session,
			templatePick.template.id,
			'LinkTemplateInteractive',
		);
	}
}
