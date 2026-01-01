import { SessionManager } from '@sessions';
import { log } from '@utils';
import { ServerResponse } from 'http';
import { AddSessionRequest, Response } from './types';

/**
 * Validate the incoming request structure
 */
export function validateRequest(request: unknown): string | null {
	if (!request || typeof request !== 'object') {
		return 'Request must be a JSON object';
	}

	const req = request as Record<string, unknown>;

	if (!req.action) {
		return 'Missing required field: action';
	}

	if (req.action === 'addSession') {
		const addRequest: AddSessionRequest = request as AddSessionRequest;

		if (!req.cookies || typeof req.cookies !== 'string') {
			return 'Missing or invalid field: cookies (must be a string)';
		}
		if (req.cookies.length === 0) {
			return 'Cookies cannot be empty';
		}
	}

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
	log.info(`Received addSession request`);

	try {
		// Create session using existing SessionManager
		const session = await SessionManager.createSession(request.cookies);

		if (await session.validate()) {
			log.notifyInfo(`Session created via server: '${session.profile.label}'`);
			// Collect all org IDs (current org + all managed orgs)
			const allOrgIds = [session.profile.org.id, ...session.profile.allManagedOrgs.map(org => org.id)];
			sendResponse(res, 200, {
				success: true,
				message: 'Session created successfully',
				sessionLabel: session.profile.label,
				orgIds: allOrgIds,
			});
		} else {
			sendResponse(res, 400, {
				success: false,
				error: 'Session created but validation failed',
			});
		}
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		log.error('Failed to create session from server request', e instanceof Error ? e : undefined);
		sendResponse(res, 500, {
			success: false,
			error: `Failed to create session: ${errorMessage}`,
		});
	}
}
