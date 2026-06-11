import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { initTestEnvironment } from '@test';
import SessionProfile from './SessionProfile';
import Session from './Session';

const { suite, test, setup, teardown } = Mocha;

function listen(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve((server.address() as AddressInfo).port);
		});
	});
}

function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close(error => (error ? reject(error) : resolve()));
	});
}

suite('Unit: Session', () => {
	let servers: Server[] = [];

	setup(() => {
		initTestEnvironment();
		servers = [];
	});

	teardown(async () => {
		await Promise.all(servers.map(server => close(server)));
	});

	test('rawGraphql sends the session cookie stored in extension secrets', async () => {
		const orgId = 'org-raw-graphql';
		const expectedCookie = 'appSession=test-cookie; other=value';
		let receivedCookie = '';
		let receivedBody: { query?: string; variables?: Record<string, unknown> } | undefined;

		const server = createServer((request, response) => {
			receivedCookie = request.headers.cookie ?? '';
			let body = '';
			request.on('data', chunk => {
				body += String(chunk);
			});
			request.on('end', () => {
				receivedBody = JSON.parse(body);
				response.writeHead(200, { 'content-type': 'application/json' });
				response.end(JSON.stringify({ data: { ok: true } }));
			});
		});
		servers.push(server);
		const port = await listen(server);

		const context = initTestEnvironment();
		await context.secrets.store(orgId, expectedCookie);

		const profile: SessionProfile = {
			region: {
				name: 'Local Test',
				cookieName: 'appSession',
				graphqlUrl: `http://127.0.0.1:${port}/graphql`,
				loginUrl: 'http://127.0.0.1',
			},
			org: { id: orgId, name: 'Raw GraphQL Org' },
			allManagedOrgs: [{ id: orgId, name: 'Raw GraphQL Org' }],
			label: 'Raw GraphQL Session',
			user: { id: 'user-1' } as SessionProfile['user'],
		};

		const session = new Session(undefined, profile);
		const result = await session.rawGraphql('query Check($id: ID!) { node(id: $id) { id } }', { id: 'n-1' });

		assert.deepStrictEqual(result, { data: { ok: true }, errors: undefined });
		assert.strictEqual(receivedCookie, expectedCookie);
		assert.match(receivedBody?.query ?? '', /query Check/);
		assert.deepStrictEqual(receivedBody?.variables, { id: 'n-1' });
	});
});
