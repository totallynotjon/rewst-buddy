import { SyncManager } from '@models';
import { SessionManager } from '@sessions';
import { createAndLinkNewTemplate, log, openTemplateById } from '@utils';
import { ServerResponse } from 'http';
import vscode from 'vscode';
import { AddSessionRequest, OpenTemplateRequest, Response } from './types';

/**
 * Validate the incoming request structure
 */
export function validateRequest(request: unknown): string | null {
	log.trace('validateRequest: validating');

	if (!request || typeof request !== 'object') {
		log.trace('validateRequest: not an object');
		return 'Request must be a JSON object';
	}

	const req = request as Record<string, unknown>;

	if (!req.action) {
		log.trace('validateRequest: missing action');
		return 'Missing required field: action';
	}

	if (req.action === 'addSession') {
		const addRequest: AddSessionRequest = request as AddSessionRequest;

		if (!req.cookies || typeof req.cookies !== 'string') {
			log.trace('validateRequest: missing or invalid cookies');
			return 'Missing or invalid field: cookies (must be a string)';
		}
		if (req.cookies.length === 0) {
			log.trace('validateRequest: empty cookies');
			return 'Cookies cannot be empty';
		}
	}

	if (req.action === 'openTemplate') {
		if (!req.orgId || typeof req.orgId !== 'string') {
			log.trace('validateRequest: missing or invalid orgId');
			return 'Missing or invalid field: orgId (must be a string)';
		}
		if (!req.templateId || typeof req.templateId !== 'string') {
			log.trace('validateRequest: missing or invalid templateId');
			return 'Missing or invalid field: templateId (must be a string)';
		}
	}

	log.trace('validateRequest: valid');
	return null;
}

/**
 * Handle the addSession action
 */
export async function handleAddSession(
	request: AddSessionRequest,
	res: ServerResponse,
	sendResponse: (res: ServerResponse, statusCode: number, body: Response) => void,
): Promise<void> {
	log.trace('handleAddSession: starting');
	log.info('handleAddSession: received request');

	try {
		log.trace('handleAddSession: creating session');
		const session = await SessionManager.createSession(request.cookies);

		log.trace('handleAddSession: validating session');
		if (await session.validate()) {
			log.debug('handleAddSession: success', { label: session.profile.label });
			log.info(`Session created via server: '${session.profile.label}'`);
			sendResponse(res, 200, {
				success: true,
				message: 'Session created successfully',
				sessionLabel: session.profile.label,
			});
		} else {
			log.debug('handleAddSession: validation failed');
			sendResponse(res, 400, {
				success: false,
				error: 'Session created but validation failed',
			});
		}
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		log.error('handleAddSession: failed', e instanceof Error ? e : undefined);
		sendResponse(res, 500, {
			success: false,
			error: `Failed to create session: ${errorMessage}`,
		});
	}
}

/**
 * Handle the openTemplate action
 */
export async function handleOpenTemplate(
	request: OpenTemplateRequest,
	res: ServerResponse,
	sendResponse: (res: ServerResponse, statusCode: number, body: Response) => void,
): Promise<void> {
	log.trace('handleOpenTemplate: starting', { orgId: request.orgId, templateId: request.templateId });
	log.info('handleOpenTemplate: received request');

	try {
		// Get session for org (needed for both paths)
		const session = SessionManager.getSessionForOrg(request.orgId);

		// Check for existing linked document
		const existingLink = await openTemplateById(request.templateId);

		if (existingLink) {
			// Existing link found - sync to latest Rewst version
			log.trace('handleOpenTemplate: syncing existing linked template');
			const template = await session.getTemplate(request.templateId);
			const uri = vscode.Uri.parse(existingLink.uriString);
			const doc = await vscode.workspace.openTextDocument(uri);
			await SyncManager.applyTemplateToDocument(doc, session, template);

			log.debug('handleOpenTemplate: opened and synced existing template');
			sendResponse(res, 200, {
				success: true,
				message: 'Opened and synced existing linked template',
			});
			return;
		}

		// No existing link - create new document
		log.trace('handleOpenTemplate: fetching template');
		const template = await session.getTemplate(request.templateId);

		// Create new document (prompts user for save location)
		log.trace('handleOpenTemplate: creating new template document');
		const saved = await createAndLinkNewTemplate(template);

		if (saved) {
			log.debug('handleOpenTemplate: template opened and linked successfully');
			sendResponse(res, 200, {
				success: true,
				message: 'Template opened and linked successfully',
			});
		} else {
			log.debug('handleOpenTemplate: user cancelled save operation');
			sendResponse(res, 200, {
				success: false,
				error: 'User cancelled save operation',
			});
		}
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		log.error('handleOpenTemplate: failed', e instanceof Error ? e : undefined);
		sendResponse(res, 500, {
			success: false,
			error: `Failed to open template: ${errorMessage}`,
		});
	}
}
