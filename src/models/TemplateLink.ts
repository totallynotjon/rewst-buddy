import { log } from '@log';
import { Template } from '@sdk';
import { RewstSessionProfile } from '@client';
import UrlPattern from 'url-pattern';
import { validate as uuidValidate } from 'uuid';

export interface TemplateURLParams {
	orgId: string;
	templateId: string;
	baseURL: URL;
}

export async function getTemplateURLParams(templateURL: string | undefined): Promise<TemplateURLParams> {
	if (!templateURL) {
		log.error('Submitted url is not a string');
		throw new Error('Submitted url is not a string');
	}

	let url: URL;

	try {
		url = new URL(templateURL);
	} catch {
		log.error(`Invalid URL ${templateURL}`);
		throw new Error(`Invalid URL ${templateURL}`);
	}

	const template = new UrlPattern('/organizations/(:orgId)/templates/(:templateId)');
	const params = template.match(url.pathname);

	if (!params) {
		log.error(`path does not match "/(:orgId)/templates/(:templateId)" ${templateURL}`);
		throw new Error('path does not match pattern');
	}

	const { orgId, templateId } = params;

	if (!uuidValidate(orgId)) {
		log.error(`Template Org ID in URL is not valid uuid: '${orgId}' of '${templateURL}'`);
		throw new Error('Template Org ID in URL is not valid uuid');
	}

	if (!uuidValidate(templateId)) {
		log.error(`Template ID in URL is not valid uuid: '${templateId}' of '${templateURL}'`);
		throw new Error('Template ID in URL is not valid uuid');
	}

	const base_url = url.host;

	const returnParams: TemplateURLParams = {
		orgId: orgId,
		templateId: templateId,
		baseURL: url,
	};
	return returnParams;
}

export default interface TemplateLink {
	sessionProfile: RewstSessionProfile;
	template: Template;
	uriString: string;
}
