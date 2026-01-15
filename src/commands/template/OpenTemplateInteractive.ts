import { pickTemplate } from '@ui';
import { createAndLinkNewTemplate, openTemplateById } from '@utils';
import GenericCommand from '../GenericCommand';

export class OpenTemplateInteractive extends GenericCommand {
	commandName = 'OpenTemplateInteractive';

	async execute(): Promise<void> {
		const pick = await pickTemplate();
		if (!pick) return;

		if (await openTemplateById(pick.template.id)) {
			return;
		}

		const template = await pick.session.getTemplate(pick.template.id);
		await createAndLinkNewTemplate(template);
	}
}
