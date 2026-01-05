import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { ensureSavedDocument, log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class DeleteTemplate extends GenericCommand {
	commandName = 'DeleteTemplate';

	async execute(...args: unknown[]): Promise<void> {
		const document = await ensureSavedDocument(args);

		let link: TemplateLink;
		try {
			link = LinkManager.getTemplateLink(document.uri);
		} catch {
			throw log.notifyError(`There is no template linked to the file to be deleted: ${document.uri.toString()}`);
		}

		const session = SessionManager.getSessionForOrg(link.org.id);

		const confirm = await vscode.window.showWarningMessage(
			`Delete template "${link.template.name}" from Rewst? This cannot be undone.`,
			{ modal: true },
			'Delete',
		);
		if (confirm !== 'Delete') return;

		const response = await session.sdk?.deleteTemplate({
			id: link.template.id,
		});

		if (typeof response?.deleteTemplate !== 'string') {
			throw log.notifyError(`Response from Rewst does not indicate success in deleting template`);
		}

		await LinkManager.removeLink(link.uriString).save();

		log.notifyInfo(`Deleted template ${link.template.organization.name}/${link.template.name} `);
	}
}
