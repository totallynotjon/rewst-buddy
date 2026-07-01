import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import vscode from 'vscode';
import { initTestEnvironment, createMockSession } from '@test';
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

	/** A local GraphQL-shaped server that answers every POST with a fixed `User` response, ignoring the query body. */
	function userServer(user: unknown): Server {
		return createServer((request, response) => {
			let body = '';
			request.on('data', chunk => {
				body += String(chunk);
			});
			request.on('end', () => {
				response.writeHead(200, { 'content-type': 'application/json' });
				response.end(JSON.stringify({ data: { user } }));
			});
		});
	}

	suite('newSdk()', () => {
		teardown(async () => {
			await vscode.workspace
				.getConfiguration('rewst-buddy')
				.update('regions', undefined, vscode.ConfigurationTarget.Global);
		});

		test('probes configured regions in order and binds to the first that accepts the cookie', async () => {
			const rejecting = userServer(null);
			const accepting = userServer({
				id: 'user-1',
				username: 'eu-user',
				organization: { id: 'org-eu', name: 'EU Org' },
				allManagedOrgs: [{ id: 'org-eu', name: 'EU Org' }],
			});
			servers.push(rejecting, accepting);
			const rejectingPort = await listen(rejecting);
			const acceptingPort = await listen(accepting);

			await vscode.workspace.getConfiguration('rewst-buddy').update(
				'regions',
				[
					{
						name: 'North America',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${rejectingPort}/graphql`,
						loginUrl: `http://127.0.0.1:${rejectingPort}`,
					},
					{
						name: 'Europe',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${acceptingPort}/graphql`,
						loginUrl: `http://127.0.0.1:${acceptingPort}`,
					},
				],
				vscode.ConfigurationTarget.Global,
			);

			const [, regionConfig] = await Session.newSdk('cookie-only-valid-in-europe');

			assert.strictEqual(regionConfig.name, 'Europe');
		});
	});

	suite('validate()', () => {
		test('caches a successful validation for 24 hours, skipping re-validation on the next call', async () => {
			const { session, wrapper } = createMockSession();

			const first = await session.validate();
			assert.strictEqual(first, true);
			assert.strictEqual(wrapper.getCallsFor('User').length, 1);

			const second = await session.validate();
			assert.strictEqual(second, true);
			assert.strictEqual(wrapper.getCallsFor('User').length, 1, 'cache hit should not re-query');
		});
	});

	suite('refreshToken()', () => {
		test('replaces the stored secret and the in-memory session with the refreshed cookie', async () => {
			const orgId = 'org-refresh';
			const oldCookie = 'appSession=old-cookie';
			const newCookie = 'appSession=new-cookie';
			let receivedLoginCookie = '';
			let receivedGraphqlCookie = '';

			const server = createServer((request, response) => {
				if (request.method === 'GET') {
					receivedLoginCookie = request.headers.cookie ?? '';
					response.writeHead(200, { 'set-cookie': newCookie });
					response.end();
					return;
				}

				let body = '';
				request.on('data', chunk => {
					body += String(chunk);
				});
				request.on('end', () => {
					receivedGraphqlCookie = request.headers.cookie ?? '';
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(JSON.stringify({ data: { user: { id: 'user-1' } } }));
				});
			});
			servers.push(server);
			const port = await listen(server);

			const context = initTestEnvironment();
			await context.secrets.store(orgId, oldCookie);

			const profile: SessionProfile = {
				region: {
					name: 'Local Test',
					cookieName: 'appSession',
					graphqlUrl: `http://127.0.0.1:${port}/graphql`,
					loginUrl: `http://127.0.0.1:${port}`,
				},
				org: { id: orgId, name: 'Refresh Org' },
				allManagedOrgs: [{ id: orgId, name: 'Refresh Org' }],
				label: 'Refresh Session',
				user: { id: 'user-1' } as SessionProfile['user'],
			};

			const session = new Session(undefined, profile);
			assert.strictEqual(session.sdk, undefined);

			await session.refreshToken();

			assert.strictEqual(receivedLoginCookie, oldCookie);
			assert.strictEqual(await context.secrets.get(orgId), newCookie);
			assert.notStrictEqual(session.sdk, undefined, 'refreshToken should replace the in-memory SDK');
			assert.strictEqual(receivedGraphqlCookie, newCookie);
		});
	});
});
