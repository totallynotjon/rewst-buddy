import { FolderLink, LinkManager, TemplateLink } from '@models';
import { SessionManager, TemplateFragment } from '@sessions';
import { log, makeUniqueUri, parseArgsUri, writeTextFile } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../../GenericCommand';

export class FetchFolder extends GenericCommand {
	commandName = 'FetchFolder';

	async execute(...args: any[]): Promise<void> {
		const uri = parseArgsUri(args);

		const folderLink = LinkManager.getFolderLink(uri);

		const { org, uriString } = folderLink;

		const ids = LinkManager.getOrgTemplateLinks(org).map(l => l.template.id);

		const session = SessionManager.getSessionForOrg(org.id);

		const response = await session.sdk?.listTemplates({ orgId: org.id });
		if (!response?.templates) throw log.notifyError("Couldn't load templates for organization");

		const templates = response.templates;

		const missingTemplates = templates.filter(t => !ids.includes(t.id));
		log.debug('Missing templates:', missingTemplates);

		for (const template of missingTemplates) {
			await this.makeTemplate(folderLink, template);
		}

		await LinkManager.save();

		log.notifyInfo(`SUCCESS: Fetched ${missingTemplates.length} templates into the folder`);
	}

	async makeTemplate(folderLink: FolderLink, template: TemplateFragment) {
		const folderUri = vscode.Uri.parse(folderLink.uriString);
		const templateUri = await makeUniqueUri(folderUri, template.name);

		try {
			await writeTextFile(templateUri, template.body);
		} catch (err) {
			log.warn(`Failed to create template file for "${template.name}": ${err}`);
			return;
		}

		const templateLink: TemplateLink = {
			type: 'Template',
			template: template,
			uriString: templateUri.toString(),
			org: folderLink.org,
		};

		LinkManager.addLink(templateLink);
	}
}
