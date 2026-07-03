import { SessionManager } from '@sessions';
import {
	close,
	createMockSession,
	createRefreshableSessionServer,
	initTestEnvironment,
	listen,
	refreshableSessionProfile,
	stub,
} from '@test';
import * as assert from 'assert';
import { createServer, type Server } from 'http';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import Session from './Session';
import SessionProfile from './SessionProfile';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: Session', () => {
	let servers: Server[] = [];
	const restores: (() => void)[] = [];

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		servers = [];
	});

	teardown(async () => {
		while (restores.length) restores.pop()!();
		SessionManager._resetForTesting();
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

		test('rejects when no configured region accepts the cookie', async () => {
			const rejectingA = userServer(null);
			const rejectingB = userServer(null);
			servers.push(rejectingA, rejectingB);
			const portA = await listen(rejectingA);
			const portB = await listen(rejectingB);

			await vscode.workspace.getConfiguration('rewst-buddy').update(
				'regions',
				[
					{
						name: 'North America',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${portA}/graphql`,
						loginUrl: `http://127.0.0.1:${portA}`,
					},
					{
						name: 'Europe',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${portB}/graphql`,
						loginUrl: `http://127.0.0.1:${portB}`,
					},
				],
				vscode.ConfigurationTarget.Global,
			);

			await assert.rejects(
				() => Session.newSdk('cookie-rejected-everywhere'),
				/could not initialize with any region/,
			);
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

		test('returns false without querying User when the session has no SDK', async () => {
			const { session, wrapper } = createMockSession();
			session.sdk = undefined;

			const result = await session.validate();

			assert.strictEqual(result, false);
			assert.strictEqual(wrapper.getCallsFor('User').length, 0, 'User is not looked up without an SDK');
		});

		test('does not cache a failed validation, re-querying on the next call', async () => {
			const { session, wrapper } = createMockSession();
			wrapper.when('User', { data: { user: null } });

			const first = await session.validate();
			assert.strictEqual(first, false);
			assert.strictEqual(wrapper.getCallsFor('User').length, 1);

			const second = await session.validate();
			assert.strictEqual(second, false);
			assert.strictEqual(wrapper.getCallsFor('User').length, 2, 'a failed validation is re-run, not cached');
		});

		test('revalidates after a failed refresh invalidates a previous success cache', async () => {
			const { session, wrapper } = createMockSession();

			const cached = await session.validate();
			assert.strictEqual(cached, true);
			assert.strictEqual(wrapper.getCallsFor('User').length, 1);

			await assert.rejects(() => session.refreshToken(), /no token found/);
			wrapper.when('User', { data: { user: null } });

			const result = await session.validate();

			assert.strictEqual(result, false);
			assert.strictEqual(
				wrapper.getCallsFor('User').length,
				2,
				'validate should not reuse a cache after refresh fails',
			);
		});
	});

	suite('ensureValid()', () => {
		test('returns true without refreshing when the session already validates', async () => {
			const { session, wrapper } = createMockSession();

			const result = await session.ensureValid();

			assert.strictEqual(result, true);
			assert.strictEqual(wrapper.getCallsFor('User').length, 1);
		});

		test('recovers via refresh when the session is initially invalid but the cookie still logs in', async () => {
			const orgId = 'org-ensure-valid-recovers';
			const { server, port, getRequestCounts } = await createRefreshableSessionServer('user-1');
			servers.push(server);

			const context = initTestEnvironment();
			await context.secrets.store(orgId, 'appSession=stale-cookie');
			// No sdk yet, so validate() fails immediately without a network call,
			// exactly like a session whose cached User() query previously failed.
			const session = new Session(undefined, refreshableSessionProfile(orgId, port, 'user-1'));

			const result = await session.ensureValid();

			assert.strictEqual(result, true);
			assert.notStrictEqual(session.sdk, undefined, 'refresh should have replaced the in-memory SDK');
			assert.strictEqual(
				getRequestCounts().post,
				1,
				'ensureValid should reuse the validation refreshToken() already performed, not re-query User()',
			);
		});

		test('returns false when the session is invalid and the refresh attempt also fails', async () => {
			const orgId = 'org-ensure-valid-dead';
			// No secret stored for this org, so refreshToken's getCookies() throws
			// before any network call — the session cannot be recovered.
			const session = new Session(undefined, refreshableSessionProfile(orgId, 0, 'user-1'));

			const result = await session.ensureValid();

			assert.strictEqual(result, false);
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

		function refreshProfile(orgId: string, port: number): SessionProfile {
			return {
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
		}

		test('throws and leaves state untouched when the login response is not ok', async () => {
			const orgId = 'org-refresh-not-ok';
			const oldCookie = 'appSession=old-cookie';
			const server = createServer((_request, response) => {
				response.writeHead(500);
				response.end();
			});
			servers.push(server);
			const port = await listen(server);

			const context = initTestEnvironment();
			await context.secrets.store(orgId, oldCookie);
			const session = new Session(undefined, refreshProfile(orgId, port));

			await assert.rejects(() => session.refreshToken(), /status 500/);
			assert.strictEqual(await context.secrets.get(orgId), oldCookie, 'stored secret is unchanged');
			assert.strictEqual(session.sdk, undefined, 'in-memory SDK is not set');
		});

		test('throws when the login response has no set-cookie header', async () => {
			const orgId = 'org-refresh-no-cookie';
			const oldCookie = 'appSession=old-cookie';
			const server = createServer((_request, response) => {
				response.writeHead(200);
				response.end();
			});
			servers.push(server);
			const port = await listen(server);

			const context = initTestEnvironment();
			await context.secrets.store(orgId, oldCookie);
			const session = new Session(undefined, refreshProfile(orgId, port));

			await assert.rejects(() => session.refreshToken(), /missing set-cookie header/);
			assert.strictEqual(await context.secrets.get(orgId), oldCookie, 'stored secret is unchanged');
		});

		test('throws when the refreshed cookie fails SDK validation', async () => {
			const orgId = 'org-refresh-invalid';
			const oldCookie = 'appSession=old-cookie';
			const server = createServer((request, response) => {
				if (request.method === 'GET') {
					response.writeHead(200, { 'set-cookie': 'appSession=new-cookie' });
					response.end();
					return;
				}
				let body = '';
				request.on('data', chunk => {
					body += String(chunk);
				});
				request.on('end', () => {
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(JSON.stringify({ data: { user: null } }));
				});
			});
			servers.push(server);
			const port = await listen(server);

			const context = initTestEnvironment();
			await context.secrets.store(orgId, oldCookie);
			const session = new Session(undefined, refreshProfile(orgId, port));

			await assert.rejects(() => session.refreshToken(), /new SDK validation failed/);
			assert.strictEqual(
				await context.secrets.get(orgId),
				oldCookie,
				'secret is not overwritten on validation failure',
			);
			assert.strictEqual(session.sdk, undefined, 'in-memory SDK is not set on validation failure');
		});

		test('single-flights concurrent calls into one login/validate round trip', async () => {
			const orgId = 'org-refresh-concurrent';
			const { server, port, getRequestCounts } = await createRefreshableSessionServer('user-1');
			servers.push(server);

			const context = initTestEnvironment();
			await context.secrets.store(orgId, 'appSession=stale-cookie');
			const session = new Session(undefined, refreshableSessionProfile(orgId, port, 'user-1'));

			await Promise.all([session.refreshToken(), session.refreshToken(), session.refreshToken()]);

			assert.deepStrictEqual(
				getRequestCounts(),
				{ get: 1, post: 1 },
				'concurrent refreshToken() callers should share one login/validate attempt',
			);
			assert.notStrictEqual(session.sdk, undefined);
		});

		function sequencedRefreshServer(statuses: number[]): { server: Server; getCount: () => number } {
			let getCount = 0;
			const server = createServer((request, response) => {
				if (request.method === 'GET') {
					const status = statuses[Math.min(getCount, statuses.length - 1)] ?? 500;
					getCount++;
					if (status >= 200 && status < 300) {
						response.writeHead(status, { 'set-cookie': `appSession=refreshed-${getCount}` });
					} else {
						response.writeHead(status);
					}
					response.end();
					return;
				}

				let body = '';
				request.on('data', chunk => {
					body += String(chunk);
				});
				request.on('end', () => {
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(JSON.stringify({ data: { user: { id: 'user-1' } } }));
				});
			});
			return { server, getCount: () => getCount };
		}

		test('expires after three consecutive refresh failures and fires one re-auth prompt', async () => {
			const orgId = 'org-refresh-expiry';
			const { server } = sequencedRefreshServer([500]);
			servers.push(server);
			const port = await listen(server);
			const context = initTestEnvironment();
			await context.secrets.store(orgId, 'appSession=dead-cookie');

			let notificationCount = 0;
			let focusSidebarCount = 0;
			restores.push(
				stub(vscode.window, 'showErrorMessage', (async (_message: string, ..._items: string[]) => {
					notificationCount++;
					return 'Re-authenticate';
				}) as unknown as typeof vscode.window.showErrorMessage),
			);
			restores.push(
				stub(vscode.commands, 'executeCommand', (async (command: string) => {
					if (command === 'rewst-buddy.FocusSidebar') focusSidebarCount++;
					return undefined;
				}) as unknown as typeof vscode.commands.executeCommand),
			);

			const session = new Session(undefined, refreshProfile(orgId, port));

			await assert.rejects(() => session.refreshToken(), /status 500/);
			assert.strictEqual(session.isExpired(), false);
			await assert.rejects(() => session.refreshToken(), /status 500/);
			assert.strictEqual(session.isExpired(), false);

			await assert.rejects(() => session.refreshToken(), /status 500/);
			await new Promise(resolve => setImmediate(resolve));

			assert.strictEqual(session.isExpired(), true);
			assert.strictEqual(notificationCount, 1);
			assert.strictEqual(focusSidebarCount, 1);

			await assert.rejects(() => session.refreshToken(), /status 500/);
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(notificationCount, 1, 'expired sessions should not keep notifying on later failures');
		});

		test('resets the consecutive failure counter after a successful refresh', async () => {
			const orgId = 'org-refresh-counter-reset';
			const { server } = sequencedRefreshServer([500, 500, 200, 500, 500]);
			servers.push(server);
			const port = await listen(server);

			const context = initTestEnvironment();
			await context.secrets.store(orgId, 'appSession=stale-cookie');
			const session = new Session(undefined, refreshProfile(orgId, port));

			await assert.rejects(() => session.refreshToken(), /status 500/);
			await assert.rejects(() => session.refreshToken(), /status 500/);
			await session.refreshToken();
			assert.strictEqual(session.isExpired(), false);

			await assert.rejects(() => session.refreshToken(), /status 500/);
			await assert.rejects(() => session.refreshToken(), /status 500/);

			assert.strictEqual(
				session.isExpired(),
				false,
				'two failures after a success should not expire the session',
			);
		});

		test('notifies session-change subscribers when the session transitions to expired', async () => {
			const orgId = 'org-refresh-expiry-event';
			const { server } = sequencedRefreshServer([500]);
			servers.push(server);
			const port = await listen(server);

			const context = initTestEnvironment();
			await context.secrets.store(orgId, 'appSession=dead-cookie');
			restores.push(
				stub(
					vscode.window,
					'showErrorMessage',
					(async () => undefined) as unknown as typeof vscode.window.showErrorMessage,
				),
			);

			const session = new Session(undefined, refreshProfile(orgId, port));
			SessionManager._setSessionsForTesting([session]);

			const events: { activeCount: number; activeOrgIds: string[] }[] = [];
			const disposable = SessionManager.onSessionChange(event => {
				events.push({
					activeCount: event.activeProfiles.length,
					activeOrgIds: event.activeProfiles.map(profile => profile.org.id),
				});
			});
			restores.push(() => disposable.dispose());

			await assert.rejects(() => session.refreshToken(), /status 500/);
			await assert.rejects(() => session.refreshToken(), /status 500/);
			await assert.rejects(() => session.refreshToken(), /status 500/);

			assert.strictEqual(session.isExpired(), true);
			assert.ok(
				events.some(event => event.activeCount === 0 && !event.activeOrgIds.includes(orgId)),
				'expiry should publish an event that removes the session from active profiles',
			);
		});
	});
});
