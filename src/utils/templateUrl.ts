import UrlPattern from 'url-pattern';
import { validate as uuidValidate } from 'uuid';
import { log } from './log';

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

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		log.error(`Unsupported URL scheme '${url.protocol}'`);
		throw new Error('Template URL scheme must be http or https');
	}
	if (url.username || url.password) {
		log.error('Template URL must not contain embedded credentials');
		throw new Error('Template URL contains embedded credentials');
	}

	const template = new UrlPattern('/organizations/(:orgId)/templates/(:templateId)');
	const normalizedPath = url.pathname.replace(/\/+$/, '');
	const params = template.match(normalizedPath);

	if (!params) {
		log.error(`path does not match "/organizations/(:orgId)/templates/(:templateId)" ${templateURL}`);
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

	const returnParams: TemplateURLParams = {
		orgId: orgId,
		templateId: templateId,
		baseURL: url,
	};
	return returnParams;
}
