import { SessionManager } from '@sessions';
import { log } from '@utils';
import { ServerResponse } from 'http';
import { AddSessionRequest, Response } from './types';

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
			const allOrgIds = [session.profile.org.id, ...session.profile.allManagedOrgs.map(org => org.id)];
			log.debug('handleAddSession: success', { label: session.profile.label, orgCount: allOrgIds.length });
			log.notifyInfo(`Session created via server: '${session.profile.label}'`);
			sendResponse(res, 200, {
				success: true,
				message: 'Session created successfully',
				sessionLabel: session.profile.label,
				orgIds: allOrgIds,
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
