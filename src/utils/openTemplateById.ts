import { LinkManager, TemplateLink } from '@models';
import vscode from 'vscode';

export async function openTemplateById(templateId: string): Promise<boolean> {
	const existingLinks = LinkManager.getTemplateLinkFromId(templateId);
	if (existingLinks.length === 0) return false;

	let link: TemplateLink | undefined = undefined;

	if (existingLinks.length === 1) {
		link = existingLinks[0];
		const uri = vscode.Uri.parse(link.uriString);
		await vscode.commands.executeCommand('vscode.open', uri);
		return true;
	}

	//pick
	const items = existingLinks.map(link => ({
		label: link.uriString,
		description: `${link.org.name} : ${link.template.id}`,
		detail: link.template.description ?? undefined,
		link,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Which matching template should we open',
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (picked) {
		link = picked.link;
		const uri = vscode.Uri.parse(link.uriString);
		await vscode.commands.executeCommand('vscode.open', uri);
		return true;
	}

	return false;
}
