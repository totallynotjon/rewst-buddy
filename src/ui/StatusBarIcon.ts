import { log } from '@utils';
import { TemplateLink, TemplateLinkManager } from '@models';
import vscode from 'vscode';

export const StatusBarIcon: vscode.StatusBarItem = vscode.window.createStatusBarItem(
	vscode.StatusBarAlignment.Left,
	100,
);
StatusBarIcon.show();

export async function updateStatusBar(e?: vscode.TextEditor | undefined) {
	const editor = e ?? vscode.window.activeTextEditor;
	if (editor === undefined) {
		clear();
		return;
	}

	const isLinked = TemplateLinkManager.isLinked(editor.document.uri);

	if (!isLinked) {
		clear();
		return;
	}

	StatusBarIcon.text = 'Rewst Buddy: $(check) Linked';

	let link;
	try {
		link = TemplateLinkManager.getLink(editor.document.uri);
	} catch {
		log.error('We failed to get the link of the active document for some reason.');
		return;
	}

	StatusBarIcon.tooltip = buildTooltip(link);
}

function buildTooltip(link: TemplateLink): vscode.MarkdownString {
	const { template, sessionProfile } = link;

	const lines: string[] = [`## ${template.name}`];

	if (template.description) {
		lines.push('', template.description);
	}

	lines.push('', '---', '', `**Organization:** ${template.organization.name}`);

	lines.push('', '---', '', `**Session:** ${sessionProfile.label}`, `**Region:** ${sessionProfile.region.name}`);

	const md = new vscode.MarkdownString(lines.join('\n'));
	md.isTrusted = true;
	return md;
}

function clear() {
	StatusBarIcon.text = 'Rewst Buddy: $(circle-large-outline) Unlinked';
	StatusBarIcon.tooltip = '';
}
