import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionProfile } from '@sessions';

export function listen(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve((server.address() as AddressInfo).port);
		});
	});
}

export function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close(error => (error ? reject(error) : resolve()));
	});
}

export interface RefreshableSessionServer {
	server: Server;
	port: number;
	getRequestCounts(): { get: number; post: number };
}

/**
 * A local server that answers a GET (refreshToken's login request) with a
 * fresh set-cookie header, and a POST (a User() query) with a fixed user
 * response — shared by Session.test.ts and SessionManager.test.ts, both of
 * which exercise a stale-but-refreshable session recovering via refresh.
 */
export async function createRefreshableSessionServer(
	userId: string,
	refreshedCookie = 'appSession=refreshed-cookie',
): Promise<RefreshableSessionServer> {
	let getCount = 0;
	let postCount = 0;

	const server = createServer((request, response) => {
		if (request.method === 'GET') {
			getCount++;
			response.writeHead(200, { 'set-cookie': refreshedCookie });
			response.end();
			return;
		}

		let body = '';
		request.on('data', chunk => {
			body += String(chunk);
		});
		request.on('end', () => {
			postCount++;
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ data: { user: { id: userId } } }));
		});
	});

	const port = await listen(server);
	return { server, port, getRequestCounts: () => ({ get: getCount, post: postCount }) };
}

export function refreshableSessionProfile(orgId: string, port: number, userId: string): SessionProfile {
	return {
		region: {
			name: 'Local Test',
			cookieName: 'appSession',
			graphqlUrl: `http://127.0.0.1:${port}/graphql`,
			loginUrl: `http://127.0.0.1:${port}`,
		},
		org: { id: orgId, name: 'Recovers Via Refresh' },
		allManagedOrgs: [{ id: orgId, name: 'Recovers Via Refresh' }],
		label: 'Recovers Via Refresh Session',
		user: { id: userId } as SessionProfile['user'],
	};
}
