import RewstSession from '@client';
import { log } from '@log';
import { Org } from '@models';
import { TemplateFragment } from '@sdk';
import vscode from 'vscode';
import { pickOrganization } from './OrganizationPicker';
import { pickSession } from './SessionPicker';

export interface TemplatePick {
	session: RewstSession;
	org: Org;
	template: TemplateFragment;
}

export async function pickTemplate(session?: RewstSession, org?: Org): Promise<TemplatePick | undefined> {
	if (!session) session = await pickSession();
	if (!session) return undefined;

	if (!org) org = (await pickOrganization(session))?.org;
	if (!org) return undefined;

	const response = await session.sdk?.listTemplatesMinimal({ orgId: org.id });
	const templates = response?.templates ?? [];

	if (templates.length === 0) {
		log.notifyWarn('No templates found for this organization.');
		return undefined;
	}

	const items = templates.map(template => ({
		label: template.name,
		description: template.id,
		detail: template.description ?? undefined,
		template,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a template',
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (picked?.template === undefined) {
		return undefined;
	}

	return {
		org: org,
		session: session,
		template: picked?.template,
	};
}
