import { context } from '@global';
import { Session, SessionManager } from '@sessions';
import {
	close,
	createMockSession,
	createRefreshableSessionServer,
	Fixtures,
	initTestEnvironment,
	listen,
	refreshableSessionProfile,
} from '@test';
import * as assert from 'assert';
import { createServer, type Server } from 'http';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import SessionProfile from './SessionProfile';

const { suite, test, setup, teardown } = Mocha;

interface MockUser {
	id: string;
	username: string;
	organization: { id: string; name: string };
	allManagedOrgs: { id: string; name: string }[];
}

/** A local GraphQL-shaped server that answers every POST with a fixed `User` response, ignoring the query body. */
function createUserServer(user: MockUser | null): Server {
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

function stubShowInputBox(impl: () => Promise<string | undefined>): () => void {
	const original = vscode.window.showInputBox;
	Object.defineProperty(vscode.window, 'showInputBox', {
		value: impl,
		configurable: true,
		writable: true,
	});
	return () => {
		Object.defineProperty(vscode.window, 'showInputBox', {
			value: original,
			configurable: true,
			writable: true,
		});
	};
}

interface SessionSaver {
	saveSession(session: Session): Promise<void>;
}

interface SessionExpirationHarness {
	handleSessionExpired(session: Session): void;
}

interface SessionProfileSaver {
	saveProfiles(): Promise<void>;
}

suite('Unit: SessionManager', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
	});

	suite('getSessionForOrg()', () => {
		test('should resolve session via org index for managed (non-primary) org', async () => {
			const { session } = createMockSession({
				profile: {
					org: { id: 'primary-org', name: 'Primary' },
					allManagedOrgs: [
						{ id: 'primary-org', name: 'Primary' },
						{ id: 'managed-org', name: 'Managed' },
					],
				},
			});

			SessionManager._setSessionsForTesting([session]);

			assert.strictEqual(await SessionManager.getSessionForOrg('managed-org'), session);
			assert.strictEqual(await SessionManager.getSessionForOrg('primary-org'), session);
		});

		test('should throw for unknown org', async () => {
			const { session } = createMockSession({
				profile: { allManagedOrgs: [{ id: 'org-a', name: 'A' }] },
			});
			SessionManager._setSessionsForTesting([session]);

			await assert.rejects(SessionManager.getSessionForOrg('unknown-org'));
		});

		test('should throw after clearProfiles()', async () => {
			const { session } = createMockSession({
				profile: { org: { id: 'org-a', name: 'A' }, allManagedOrgs: [{ id: 'org-a', name: 'A' }] },
			});
			SessionManager._setSessionsForTesting([session]);
			assert.strictEqual(await SessionManager.getSessionForOrg('org-a'), session);

			await SessionManager.clearProfiles();

			await assert.rejects(SessionManager.getSessionForOrg('org-a'));
		});

		test('re-auth for same user purges index entries for dropped orgs', async () => {
			const user = Fixtures.userFragment({ id: 'user-1' });
			const { session: first } = createMockSession({
				profile: {
					user,
					org: { id: 'org-a', name: 'A' },
					allManagedOrgs: [
						{ id: 'org-a', name: 'A' },
						{ id: 'org-b', name: 'B' },
					],
				},
			});
			const { session: second } = createMockSession({
				profile: {
					user,
					org: { id: 'org-a', name: 'A' },
					allManagedOrgs: [{ id: 'org-a', name: 'A' }],
				},
			});

			const saver = SessionManager as unknown as SessionSaver;
			await saver.saveSession(first);
			assert.strictEqual(await SessionManager.getSessionForOrg('org-b'), first);

			await saver.saveSession(second);

			assert.strictEqual(await SessionManager.getSessionForOrg('org-a'), second);
			await assert.rejects(
				SessionManager.getSessionForOrg('org-b'),
				'dropped org should no longer resolve to the stale session',
			);
		});

		test('skips a session that no longer validates and falls through to another capable session', async () => {
			const { session: stale, wrapper: staleWrapper } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-stale' }),
					org: { id: 'dup-org', name: 'Stale' },
					allManagedOrgs: [{ id: 'dup-org', name: 'Stale' }],
				},
			});
			staleWrapper.when('User', { data: { user: null } });
			const { session: fresh } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-fresh' }),
					org: { id: 'dup-org', name: 'Fresh' },
					allManagedOrgs: [{ id: 'dup-org', name: 'Fresh' }],
				},
			});
			SessionManager._setSessionsForTesting([stale, fresh]);

			const resolved = await SessionManager.getSessionForOrg('dup-org');
			assert.strictEqual(
				resolved,
				fresh,
				'an invalid session must not be returned when another capable session is still valid',
			);
		});

		test('throws when every session capable of managing the org has gone invalid', async () => {
			const { session, wrapper } = createMockSession({
				profile: {
					org: { id: 'org-all-stale', name: 'Stale' },
					allManagedOrgs: [{ id: 'org-all-stale', name: 'Stale' }],
				},
			});
			wrapper.when('User', { data: { user: null } });
			SessionManager._setSessionsForTesting([session]);

			await assert.rejects(SessionManager.getSessionForOrg('org-all-stale'));
		});

		test('recovers a stale-but-refreshable session via refresh instead of skipping or failing it', async () => {
			const orgId = 'org-recovers-via-refresh';
			const { server, port } = await createRefreshableSessionServer('user-recovers');

			try {
				// D4: cookies are keyed by user id, not org id.
				await context.secrets.store('user-recovers', 'appSession=stale-cookie');
				// No sdk yet: validate() fails immediately, exactly like a session
				// whose cached User() query previously failed.
				const session = new Session(undefined, refreshableSessionProfile(orgId, port, 'user-recovers'));
				SessionManager._setSessionsForTesting([session]);

				const resolved = await SessionManager.getSessionForOrg(orgId);

				assert.strictEqual(
					resolved,
					session,
					'the same session recovers rather than being reported unreachable',
				);
				assert.notStrictEqual(session.sdk, undefined, 'refresh should have replaced the in-memory SDK');
			} finally {
				await close(server);
			}
		});
	});

	// Contract from openspec/specs/session-auth "Manage multiple organizations
	// per session": region-scoped resolution matches managed sub-orgs, returns
	// the first capable session for duplicate org ids, and only returns sessions
	// that still validate.
	suite('multi-org resolution (spec contract)', () => {
		test('getOrgSession resolves a managed sub-org within the requested region', async () => {
			const { session } = createMockSession({
				profile: {
					org: { id: 'parent-org', name: 'Parent' },
					allManagedOrgs: [
						{ id: 'parent-org', name: 'Parent' },
						{ id: 'sub-org', name: 'Sub' },
					],
				},
			});
			SessionManager._setSessionsForTesting([session]);

			const resolved = await SessionManager.getOrgSession('sub-org', new URL(session.profile.region.loginUrl));
			assert.strictEqual(resolved, session);
		});

		test('a duplicate org id resolves to a capable session instead of failing as ambiguous', async () => {
			const { session: northAmerica } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-na' }),
					org: { id: 'dup-org', name: 'Dup NA' },
					allManagedOrgs: [{ id: 'dup-org', name: 'Dup NA' }],
					region: {
						name: 'North America',
						cookieName: 'appSession',
						graphqlUrl: 'https://api.rewst.io/graphql',
						loginUrl: 'https://app.rewst.io',
					},
				},
			});
			const { session: europe } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-eu' }),
					org: { id: 'dup-org', name: 'Dup EU' },
					allManagedOrgs: [{ id: 'dup-org', name: 'Dup EU' }],
					region: {
						name: 'Europe',
						cookieName: 'appSession',
						graphqlUrl: 'https://api.eu.rewst.io/graphql',
						loginUrl: 'https://app.eu.rewst.io',
					},
				},
			});
			SessionManager._setSessionsForTesting([northAmerica, europe]);

			const resolved = await SessionManager.getSessionForOrg('dup-org');
			assert.ok(
				resolved === northAmerica || resolved === europe,
				'a shared org id must resolve to one of the capable sessions, not error',
			);
		});

		test('getOrgSession does not return a session that no longer validates', async () => {
			const { session, wrapper } = createMockSession({
				profile: {
					org: { id: 'org-a', name: 'A' },
					allManagedOrgs: [{ id: 'org-a', name: 'A' }],
				},
			});
			wrapper.when('User', { data: { user: null } });
			SessionManager._setSessionsForTesting([session]);

			await assert.rejects(
				SessionManager.getOrgSession('org-a', new URL(session.profile.region.loginUrl)),
				'a session whose validation fails must be skipped, leaving no session to return',
			);
		});

		test('getOrgSession recovers a stale-but-refreshable session via refresh instead of skipping it', async () => {
			const orgId = 'org-recovers-region-scoped';
			const { server, port } = await createRefreshableSessionServer('user-region-recovers');

			try {
				// D4: cookies are keyed by user id, not org id.
				await context.secrets.store('user-region-recovers', 'appSession=stale-cookie');
				// No sdk yet: validate() fails immediately, exactly like a session
				// whose cached User() query previously failed.
				const session = new Session(undefined, refreshableSessionProfile(orgId, port, 'user-region-recovers'));
				SessionManager._setSessionsForTesting([session]);

				const resolved = await SessionManager.getOrgSession(orgId, new URL(session.profile.region.loginUrl));

				assert.strictEqual(resolved, session, 'the same session recovers rather than being skipped');
				assert.notStrictEqual(session.sdk, undefined, 'refresh should have replaced the in-memory SDK');
			} finally {
				await close(server);
			}
		});

		test('getProfileForOrg returns a capable profile when several known profiles share an org id', () => {
			const { session: northAmerica } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-na' }),
					org: { id: 'shared-org', name: 'Shared NA' },
					allManagedOrgs: [{ id: 'shared-org', name: 'Shared NA' }],
					region: {
						name: 'North America',
						cookieName: 'appSession',
						graphqlUrl: 'https://api.rewst.io/graphql',
						loginUrl: 'https://app.rewst.io',
					},
				},
			});
			const { session: europe } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-eu' }),
					org: { id: 'shared-org', name: 'Shared EU' },
					allManagedOrgs: [{ id: 'shared-org', name: 'Shared EU' }],
					region: {
						name: 'Europe',
						cookieName: 'appSession',
						graphqlUrl: 'https://api.eu.rewst.io/graphql',
						loginUrl: 'https://app.eu.rewst.io',
					},
				},
			});
			SessionManager._setKnownProfilesForTesting([northAmerica.profile, europe.profile]);

			const profile = SessionManager.getProfileForOrg('shared-org');
			assert.ok(profile, 'a shared org id must still resolve to a known profile');
			assert.strictEqual(profile.org.id, 'shared-org');
		});
	});

	suite('known profiles cache', () => {
		test('getProfileForOrg resolves after _setKnownProfilesForTesting', () => {
			const { session } = createMockSession({
				profile: {
					org: { id: 'known-org', name: 'Known' },
					allManagedOrgs: [{ id: 'known-org', name: 'Known' }],
				},
			});

			SessionManager._setKnownProfilesForTesting([session.profile]);

			const profile = SessionManager.getProfileForOrg('known-org');
			assert.ok(profile);
			assert.strictEqual(profile.org.id, 'known-org');
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 1);
		});

		test('cache is invalidated by _resetForTesting', () => {
			const { session } = createMockSession({
				profile: { allManagedOrgs: [{ id: 'org-x', name: 'X' }] },
			});
			SessionManager._setKnownProfilesForTesting([session.profile]);
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 1);

			SessionManager._resetForTesting();
			initTestEnvironment();

			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
			assert.strictEqual(SessionManager.getProfileForOrg('org-x'), undefined);
		});
	});

	suite('createSession()', () => {
		let servers: Server[] = [];

		setup(() => {
			servers = [];
		});

		teardown(async () => {
			await Promise.all(servers.map(server => close(server)));
			await vscode.workspace
				.getConfiguration('rewst-buddy')
				.update('regions', undefined, vscode.ConfigurationTarget.Global);
		});

		test('valid cookie produces a session whose profile.label is "{username} ({orgName})"', async () => {
			const server = createUserServer({
				id: 'user-1',
				username: 'jdoe',
				organization: { id: 'org-create', name: 'Acme Co' },
				allManagedOrgs: [{ id: 'org-create', name: 'Acme Co' }],
			});
			servers.push(server);
			const port = await listen(server);

			await vscode.workspace.getConfiguration('rewst-buddy').update(
				'regions',
				[
					{
						name: 'Local Test',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${port}/graphql`,
						loginUrl: `http://127.0.0.1:${port}`,
					},
				],
				vscode.ConfigurationTarget.Global,
			);

			// newSdk tries the "{cookieName}={token}" variant first, so a raw token
			// (rather than a pre-formatted cookie) deterministically resolves to
			// that variant on this always-accepting mock server.
			const session = await SessionManager.createSession('raw-test-token');

			assert.strictEqual(session.profile.label, 'jdoe (Acme Co)');
			assert.strictEqual(await SessionManager.getSessionForOrg('org-create'), session);
			// D4: cookies are keyed by user id, and the legacy org-id key is cleaned up.
			assert.strictEqual(await context.secrets.get('user-1'), 'appSession=raw-test-token');
			assert.strictEqual(
				await context.secrets.get('org-create'),
				undefined,
				'no live secret should remain under the legacy org-id key',
			);
		});

		test('user query asks for recursive managed sub-orgs and indexes deep descendants', async () => {
			let graphqlBody = '';
			const server = createServer((request, response) => {
				request.on('data', chunk => {
					graphqlBody += String(chunk);
				});
				request.on('end', () => {
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(
						JSON.stringify({
							data: {
								user: {
									id: 'user-deep',
									username: 'deep-user',
									organization: {
										id: 'org-root',
										name: 'Root',
										managedAndSubOrgs: [
											{ id: 'org-direct', name: 'Direct Child' },
											{ id: 'org-grandchild', name: 'Grandchild' },
										],
									},
									allManagedOrgs: [{ id: 'org-direct', name: 'Direct Child' }],
									roleIds: [],
								},
							},
						}),
					);
				});
			});
			servers.push(server);
			const port = await listen(server);

			await vscode.workspace.getConfiguration('rewst-buddy').update(
				'regions',
				[
					{
						name: 'Local Test',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${port}/graphql`,
						loginUrl: `http://127.0.0.1:${port}`,
					},
				],
				vscode.ConfigurationTarget.Global,
			);

			const session = await SessionManager.createSession('raw-test-token');

			assert.match(graphqlBody, /managedAndSubOrgs/, 'login profile query must request the recursive org tree');
			assert.strictEqual(await SessionManager.getSessionForOrg('org-grandchild'), session);
		});

		test('managed org set is the union of managedOrgs and the recursive sub-org tree', async () => {
			const server = createServer((request, response) => {
				request.on('data', () => {});
				request.on('end', () => {
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(
						JSON.stringify({
							data: {
								user: {
									id: 'user-union',
									username: 'union-user',
									organization: {
										id: 'org-root',
										name: 'Root',
										managedAndSubOrgs: [{ id: 'org-own-sub', name: 'Own Sub-Org' }],
									},
									allManagedOrgs: [{ id: 'org-managed-only', name: 'Managed Elsewhere' }],
									roleIds: [],
								},
							},
						}),
					);
				});
			});
			servers.push(server);
			const port = await listen(server);

			await vscode.workspace.getConfiguration('rewst-buddy').update(
				'regions',
				[
					{
						name: 'Local Test',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${port}/graphql`,
						loginUrl: `http://127.0.0.1:${port}`,
					},
				],
				vscode.ConfigurationTarget.Global,
			);

			const session = await SessionManager.createSession('raw-test-token');

			assert.strictEqual(
				await SessionManager.getSessionForOrg('org-managed-only'),
				session,
				'an org present only in managedOrgs must stay reachable when managedAndSubOrgs is also returned',
			);
			assert.strictEqual(
				await SessionManager.getSessionForOrg('org-own-sub'),
				session,
				'a sub-org present only in the recursive tree must be reachable',
			);
		});

		test('empty input is rejected and no session is created', async () => {
			const unstub = stubShowInputBox(async () => '');

			try {
				await assert.rejects(() => SessionManager.createSession());
			} finally {
				unstub();
			}

			assert.strictEqual(SessionManager.getActiveSessions().length, 0);
		});

		test('two users sharing the same primary org get separate user-keyed secrets', async () => {
			const users = [
				{ id: 'user-shared-a', username: 'user-a' },
				{ id: 'user-shared-b', username: 'user-b' },
			];
			// Key the response off the cookie's token rather than call order: each
			// createSession() call makes two requests (newSdk's internal validation
			// plus its own explicit User() call), so counting calls would misalign.
			const server = createServer((request, response) => {
				const cookieHeader = request.headers.cookie ?? '';
				const user = cookieHeader.includes('token-a') ? users[0] : users[1];
				request.on('data', () => {});
				request.on('end', () => {
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(
						JSON.stringify({
							data: {
								user: {
									id: user.id,
									username: user.username,
									organization: { id: 'org-shared', name: 'Shared Org' },
									allManagedOrgs: [{ id: 'org-shared', name: 'Shared Org' }],
								},
							},
						}),
					);
				});
			});
			servers.push(server);
			const port = await listen(server);

			await vscode.workspace.getConfiguration('rewst-buddy').update(
				'regions',
				[
					{
						name: 'Local Test',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${port}/graphql`,
						loginUrl: `http://127.0.0.1:${port}`,
					},
				],
				vscode.ConfigurationTarget.Global,
			);

			await SessionManager.createSession('token-a');
			const sessionB = await SessionManager.createSession('token-b');

			assert.strictEqual(await context.secrets.get('user-shared-a'), 'appSession=token-a');
			assert.strictEqual(await context.secrets.get('user-shared-b'), 'appSession=token-b');

			await SessionManager.removeSession('user-shared-a');

			assert.strictEqual(await context.secrets.get('user-shared-a'), undefined);
			assert.strictEqual(
				await context.secrets.get('user-shared-b'),
				'appSession=token-b',
				"the other user's secret survives even though both share the primary org id",
			);
			assert.strictEqual(await SessionManager.getSessionForOrg('org-shared'), sessionB);
		});
	});

	suite('loadSessions()', () => {
		let servers: Server[] = [];

		setup(() => {
			servers = [];
		});

		teardown(async () => {
			await Promise.all(servers.map(server => close(server)));
			await vscode.workspace
				.getConfiguration('rewst-buddy')
				.update('regions', undefined, vscode.ConfigurationTarget.Global);
		});

		test('restores sessions from saved profiles and secrets on activation, without prompting', async () => {
			const server = createUserServer({
				id: 'user-1',
				username: 'restored-user',
				organization: { id: 'org-restore', name: 'Restored Org' },
				allManagedOrgs: [{ id: 'org-restore', name: 'Restored Org' }],
			});
			servers.push(server);
			const port = await listen(server);

			const region = {
				name: 'Local Test',
				cookieName: 'appSession',
				graphqlUrl: `http://127.0.0.1:${port}/graphql`,
				loginUrl: `http://127.0.0.1:${port}`,
			};
			await vscode.workspace
				.getConfiguration('rewst-buddy')
				.update('regions', [region], vscode.ConfigurationTarget.Global);

			const savedProfile: SessionProfile = {
				region,
				org: { id: 'org-restore', name: 'Restored Org' },
				allManagedOrgs: [{ id: 'org-restore', name: 'Restored Org' }],
				label: 'restored-user (Restored Org)',
				user: { id: 'user-1' } as SessionProfile['user'],
			};
			await context.globalState.update('SessionProfiles', [savedProfile]);
			await context.secrets.store('org-restore', 'appSession=restored-cookie');

			let promptCalled = false;
			const unstub = stubShowInputBox(async () => {
				promptCalled = true;
				return '';
			});

			let sessions: Session[];
			try {
				sessions = await SessionManager.loadSessions();
			} finally {
				unstub();
			}

			assert.strictEqual(sessions.length, 1);
			assert.strictEqual(sessions[0].profile.org.id, 'org-restore');
			assert.strictEqual(promptCalled, false, 'loadSessions must not prompt for a cookie');
			assert.strictEqual(await SessionManager.getSessionForOrg('org-restore'), sessions[0]);
			// D4: a legacy org-keyed cookie is migrated to the user-id key on restore.
			// (Substring, not exact-equality: newSdk tries several equally-acceptable
			// cookie-string variants against this always-accepting mock server, so the
			// winning candidate's exact prefix isn't significant here — only that the
			// migrated value lives under the user-id key now.)
			assert.match(
				(await context.secrets.get('user-1')) ?? '',
				/restored-cookie/,
				'legacy org-keyed cookie must be migrated to the user-id key',
			);
			assert.strictEqual(
				await context.secrets.get('org-restore'),
				undefined,
				'legacy org-keyed cookie is cleaned up once migrated',
			);
		});

		test('prefers a user-keyed cookie over a legacy org-keyed cookie when both exist', async () => {
			const server = createServer((request, response) => {
				const cookieHeader = request.headers.cookie ?? '';
				let body = '';
				request.on('data', chunk => {
					body += String(chunk);
				});
				request.on('end', () => {
					response.writeHead(200, { 'content-type': 'application/json' });
					// Only the user-keyed cookie value should ever be sent; a legacy
					// org-keyed read would send the wrong value and fail to resolve a user.
					if (cookieHeader.includes('user-key-cookie')) {
						response.end(
							JSON.stringify({
								data: {
									user: {
										id: 'user-both',
										username: 'both-user',
										organization: { id: 'org-both', name: 'Both Org' },
										allManagedOrgs: [{ id: 'org-both', name: 'Both Org' }],
									},
								},
							}),
						);
					} else {
						response.end(JSON.stringify({ data: { user: null } }));
					}
				});
			});
			servers.push(server);
			const port = await listen(server);

			const region = {
				name: 'Local Test',
				cookieName: 'appSession',
				graphqlUrl: `http://127.0.0.1:${port}/graphql`,
				loginUrl: `http://127.0.0.1:${port}`,
			};
			await vscode.workspace
				.getConfiguration('rewst-buddy')
				.update('regions', [region], vscode.ConfigurationTarget.Global);

			const savedProfile: SessionProfile = {
				region,
				org: { id: 'org-both', name: 'Both Org' },
				allManagedOrgs: [{ id: 'org-both', name: 'Both Org' }],
				label: 'both-user (Both Org)',
				user: { id: 'user-both' } as SessionProfile['user'],
			};
			await context.globalState.update('SessionProfiles', [savedProfile]);
			await context.secrets.store('user-both', 'appSession=user-key-cookie');
			await context.secrets.store('org-both', 'appSession=legacy-org-key-cookie');

			const sessions = await SessionManager.loadSessions();

			assert.strictEqual(sessions.length, 1, 'the user-keyed cookie must be the one used to restore the session');
			assert.strictEqual(sessions[0].profile.user.id, 'user-both');
		});

		test('concurrent loadSessions() calls share one in-flight promise and create each session once', async () => {
			let requestCount = 0;
			const server = createServer((request, response) => {
				request.on('data', () => {});
				request.on('end', () => {
					requestCount++;
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(
						JSON.stringify({
							data: {
								user: {
									id: 'user-concurrent',
									username: 'concurrent-user',
									organization: { id: 'org-concurrent', name: 'Concurrent Org' },
									allManagedOrgs: [{ id: 'org-concurrent', name: 'Concurrent Org' }],
								},
							},
						}),
					);
				});
			});
			servers.push(server);
			const port = await listen(server);

			const region = {
				name: 'Local Test',
				cookieName: 'appSession',
				graphqlUrl: `http://127.0.0.1:${port}/graphql`,
				loginUrl: `http://127.0.0.1:${port}`,
			};
			await vscode.workspace
				.getConfiguration('rewst-buddy')
				.update('regions', [region], vscode.ConfigurationTarget.Global);

			const savedProfile: SessionProfile = {
				region,
				org: { id: 'org-concurrent', name: 'Concurrent Org' },
				allManagedOrgs: [{ id: 'org-concurrent', name: 'Concurrent Org' }],
				label: 'concurrent-user (Concurrent Org)',
				user: { id: 'user-concurrent' } as SessionProfile['user'],
			};
			await context.globalState.update('SessionProfiles', [savedProfile]);
			await context.secrets.store('user-concurrent', 'appSession=concurrent-cookie');

			const [first, second] = await Promise.all([SessionManager.loadSessions(), SessionManager.loadSessions()]);

			// createSession() makes two requests per profile (newSdk's internal
			// validation, then its own explicit User() call) — 2, not 4, proves
			// createSession ran once despite two concurrent loadSessions() callers.
			assert.strictEqual(
				requestCount,
				2,
				'createSession must run once per profile even under concurrent callers',
			);
			assert.strictEqual(
				first,
				second,
				'concurrent callers receive the same resolved result via the shared promise',
			);
			assert.strictEqual(first.length, 1);
		});

		test('a rejected load clears the in-flight promise so a later call retries', async () => {
			const manager = SessionManager as unknown as SessionProfileSaver;
			const originalSaveProfiles = manager.saveProfiles.bind(SessionManager);
			let calls = 0;
			Object.defineProperty(SessionManager, 'saveProfiles', {
				value: async () => {
					calls++;
					if (calls === 1) throw new Error('boom');
					return originalSaveProfiles();
				},
				configurable: true,
				writable: true,
			});

			try {
				await assert.rejects(SessionManager.loadSessions(), /boom/);
				await assert.doesNotReject(
					SessionManager.loadSessions(),
					'a later call must retry rather than reuse the rejected promise',
				);
			} finally {
				Object.defineProperty(SessionManager, 'saveProfiles', {
					value: originalSaveProfiles,
					configurable: true,
					writable: true,
				});
			}
		});

		test('a session removed while loadSessions is in flight is not resurrected by the load', async () => {
			// Server that holds every response until released, so Remove Session
			// can run while the load's createSession is still awaiting the network.
			let release!: () => void;
			const gate = new Promise<void>(resolve => (release = resolve));
			const user = {
				id: 'user-late',
				username: 'late-user',
				organization: { id: 'org-late', name: 'Late Org' },
				allManagedOrgs: [{ id: 'org-late', name: 'Late Org' }],
			};
			const server = createServer((request, response) => {
				request.on('data', () => {});
				request.on('end', async () => {
					await gate;
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(JSON.stringify({ data: { user } }));
				});
			});
			servers.push(server);
			const port = await listen(server);

			const region = {
				name: 'Local Test',
				cookieName: 'appSession',
				graphqlUrl: `http://127.0.0.1:${port}/graphql`,
				loginUrl: `http://127.0.0.1:${port}`,
			};
			await vscode.workspace
				.getConfiguration('rewst-buddy')
				.update('regions', [region], vscode.ConfigurationTarget.Global);

			const savedProfile: SessionProfile = {
				region,
				org: { id: 'org-late', name: 'Late Org' },
				allManagedOrgs: [{ id: 'org-late', name: 'Late Org' }],
				label: 'late-user (Late Org)',
				user: { id: 'user-late' } as SessionProfile['user'],
			};
			await context.globalState.update('SessionProfiles', [savedProfile]);
			await context.globalState.update('RewstAllKnownProfiles', [savedProfile]);
			await context.secrets.store('org-late', 'appSession=late-cookie');

			const loadPromise = SessionManager.loadSessions();
			// Give the load a moment to read the cookie and start the request.
			await new Promise(resolve => setTimeout(resolve, 50));

			await SessionManager.removeSession('user-late');
			release();
			await loadPromise;

			assert.strictEqual(
				SessionManager.getActiveSessions().length,
				0,
				'the removed session must not be resurrected by the in-flight load',
			);
			assert.strictEqual(
				await context.secrets.get('org-late'),
				undefined,
				'the removed session cookie must not be re-stored by the load',
			);
			assert.strictEqual(
				await context.secrets.get('user-late'),
				undefined,
				'the migrated user-keyed cookie must not survive the purge either',
			);
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
			await assert.rejects(SessionManager.getSessionForOrg('org-late'));
		});
	});

	suite('clearProfiles()', () => {
		test('deletes secrets for primary and managed orgs, and clears known-profile state', async () => {
			const { session } = createMockSession({
				profile: {
					org: { id: 'org-clear-primary', name: 'Primary' },
					allManagedOrgs: [
						{ id: 'org-clear-primary', name: 'Primary' },
						{ id: 'org-clear-managed', name: 'Managed' },
					],
				},
			});

			// Primary-org secret plus a legacy managed-org secret key, both of which
			// must be deleted by clearProfiles().
			await context.secrets.store('org-clear-primary', 'cookie-primary');
			await context.secrets.store('org-clear-managed', 'cookie-managed');

			SessionManager._setSessionsForTesting([session]);
			SessionManager._setKnownProfilesForTesting([session.profile]);

			assert.strictEqual(await context.secrets.get('org-clear-primary'), 'cookie-primary');
			assert.strictEqual(await context.secrets.get('org-clear-managed'), 'cookie-managed');
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 1);

			await SessionManager.clearProfiles();

			assert.strictEqual(await context.secrets.get('org-clear-primary'), undefined);
			assert.strictEqual(await context.secrets.get('org-clear-managed'), undefined);
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
			await assert.rejects(SessionManager.getSessionForOrg('org-clear-primary'));
		});

		test('deletes secrets for profiles saved only in SessionProfiles', async () => {
			const savedOnlyProfile: SessionProfile = {
				region: {
					name: 'Local Test',
					cookieName: 'appSession',
					graphqlUrl: 'http://127.0.0.1/graphql',
					loginUrl: 'http://127.0.0.1',
				},
				org: { id: 'org-saved-primary', name: 'Saved Primary' },
				allManagedOrgs: [
					{ id: 'org-saved-primary', name: 'Saved Primary' },
					{ id: 'org-saved-managed', name: 'Saved Managed' },
				],
				label: 'saved-user (Saved Primary)',
				user: { id: 'saved-user' } as SessionProfile['user'],
			};
			await context.globalState.update('SessionProfiles', [savedOnlyProfile]);
			await context.secrets.store('org-saved-primary', 'cookie-primary');
			await context.secrets.store('org-saved-managed', 'cookie-managed');

			await SessionManager.clearProfiles();

			assert.strictEqual(await context.secrets.get('org-saved-primary'), undefined);
			assert.strictEqual(await context.secrets.get('org-saved-managed'), undefined);
			assert.deepStrictEqual(context.globalState.get('SessionProfiles'), []);
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
		});

		test('deletes user-id keyed secrets for both an active session and a known-only profile', async () => {
			// D4: clearProfiles must delete the current user-keyed secret for every
			// active and known profile, not merely legacy org-keyed leftovers.
			const { session } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-clear-active' }),
					org: { id: 'org-clear-active', name: 'Active' },
					allManagedOrgs: [{ id: 'org-clear-active', name: 'Active' }],
				},
			});
			const knownOnlyProfile: SessionProfile = {
				region: {
					name: 'Local Test',
					cookieName: 'appSession',
					graphqlUrl: 'http://127.0.0.1/graphql',
					loginUrl: 'http://127.0.0.1',
				},
				org: { id: 'org-clear-known', name: 'Known' },
				allManagedOrgs: [{ id: 'org-clear-known', name: 'Known' }],
				label: 'known-user (Known)',
				user: { id: 'user-clear-known' } as SessionProfile['user'],
			};

			await context.secrets.store('user-clear-active', 'cookie-active-user');
			await context.secrets.store('user-clear-known', 'cookie-known-user');

			SessionManager._setSessionsForTesting([session]);
			SessionManager._setKnownProfilesForTesting([session.profile, knownOnlyProfile]);

			await SessionManager.clearProfiles();

			assert.strictEqual(
				await context.secrets.get('user-clear-active'),
				undefined,
				"the active session's user-keyed secret is deleted",
			);
			assert.strictEqual(
				await context.secrets.get('user-clear-known'),
				undefined,
				"the known-only profile's user-keyed secret is deleted",
			);
		});
	});

	suite('removeSession()', () => {
		test('expired active session emits a removed event for metadata consumers', () => {
			const { session } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-expired' }),
					org: { id: 'org-expired-primary', name: 'Expired Primary' },
					allManagedOrgs: [
						{ id: 'org-expired-primary', name: 'Expired Primary' },
						{ id: 'org-expired-managed', name: 'Expired Managed' },
					],
				},
			});
			SessionManager._setSessionsForTesting([session]);

			const events: { type: string; activeOrgIds: string[] }[] = [];
			const disposable = SessionManager.onSessionChange(event => {
				events.push({
					type: event.type,
					activeOrgIds: event.activeProfiles.map(profile => profile.org.id),
				});
			});
			try {
				(SessionManager as unknown as SessionExpirationHarness).handleSessionExpired(session);
			} finally {
				disposable.dispose();
			}

			assert.deepStrictEqual(events, [{ type: 'removed', activeOrgIds: [] }]);
			assert.strictEqual(SessionManager.getActiveSessions().length, 0);
		});

		test('removes an active session: deletes its cookie, drops it from active and known profiles, and clears the org index', async () => {
			const { session } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-remove' }),
					org: { id: 'org-remove-primary', name: 'Primary' },
					allManagedOrgs: [
						{ id: 'org-remove-primary', name: 'Primary' },
						{ id: 'org-remove-managed', name: 'Managed' },
					],
				},
			});
			// D4: removeSession deletes the user-id key plus the profile's own legacy
			// org-id key. A secret sitting under a *managed*-org id was never written
			// by any real create/load path even pre-D4 (createSession only ever wrote
			// under the profile's own primary org id), so there's nothing to clean up
			// there anymore — that coverage is superseded by the user-keyed scheme.
			await context.secrets.store('user-remove', 'cookie-user');
			await context.secrets.store('org-remove-primary', 'cookie-primary');

			const saver = SessionManager as unknown as SessionSaver;
			await saver.saveSession(session);
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 1);

			await SessionManager.removeSession('user-remove');

			assert.strictEqual(await context.secrets.get('user-remove'), undefined);
			assert.strictEqual(await context.secrets.get('org-remove-primary'), undefined);
			assert.strictEqual(SessionManager.getActiveSessions().length, 0);
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
			await assert.rejects(SessionManager.getSessionForOrg('org-remove-primary'));
		});

		test('removes a known-only (previously authenticated) session with no active session', async () => {
			const knownProfile: SessionProfile = {
				region: {
					name: 'Local Test',
					cookieName: 'appSession',
					graphqlUrl: 'http://127.0.0.1/graphql',
					loginUrl: 'http://127.0.0.1',
				},
				org: { id: 'org-known-only', name: 'Known Only' },
				allManagedOrgs: [{ id: 'org-known-only', name: 'Known Only' }],
				label: 'known-user (Known Only)',
				user: { id: 'known-user' } as SessionProfile['user'],
			};
			SessionManager._setKnownProfilesForTesting([knownProfile]);
			await context.secrets.store('org-known-only', 'cookie-known');

			await SessionManager.removeSession('known-user');

			assert.strictEqual(await context.secrets.get('org-known-only'), undefined);
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 0);
			assert.strictEqual(SessionManager.getProfileForOrg('org-known-only'), undefined);
		});

		test('removing one active session leaves another active session untouched', async () => {
			const { session: first } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-a' }),
					org: { id: 'org-a', name: 'A' },
					allManagedOrgs: [{ id: 'org-a', name: 'A' }],
				},
			});
			const { session: second } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-b' }),
					org: { id: 'org-b', name: 'B' },
					allManagedOrgs: [{ id: 'org-b', name: 'B' }],
				},
			});
			const saver = SessionManager as unknown as SessionSaver;
			await saver.saveSession(first);
			await saver.saveSession(second);

			await SessionManager.removeSession('user-a');

			assert.strictEqual(SessionManager.getActiveSessions().length, 1);
			assert.strictEqual(await SessionManager.getSessionForOrg('org-b'), second);
			await assert.rejects(SessionManager.getSessionForOrg('org-a'));
			assert.strictEqual(SessionManager.hasActiveSessions(), true);
		});

		test('removing the only active session clears the active-sessions context', async () => {
			const { session } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-solo' }),
					org: { id: 'org-solo', name: 'Solo' },
					allManagedOrgs: [{ id: 'org-solo', name: 'Solo' }],
				},
			});
			const saver = SessionManager as unknown as SessionSaver;
			await saver.saveSession(session);
			assert.strictEqual(SessionManager.hasActiveSessions(), true);

			await SessionManager.removeSession('user-solo');

			assert.strictEqual(SessionManager.hasActiveSessions(), false);
		});

		test('throws when no active or known session matches the given user id', async () => {
			await assert.rejects(SessionManager.removeSession('does-not-exist'));
		});

		test('another session is unaffected when removing a session whose managed orgs overlap it', async () => {
			// D4: secrets are keyed by user id, so two profiles overlapping on an org
			// id (parent manages org-child, child's own primary org is org-child) can
			// never collide on the same secret key the way the old org-keyed scheme
			// could — this asserts that invariant plus the still-relevant org-index behavior.
			const { session: parent } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-parent' }),
					org: { id: 'org-parent', name: 'Parent' },
					allManagedOrgs: [
						{ id: 'org-parent', name: 'Parent' },
						{ id: 'org-child', name: 'Child' },
					],
				},
			});
			const { session: child } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-child' }),
					org: { id: 'org-child', name: 'Child' },
					allManagedOrgs: [{ id: 'org-child', name: 'Child' }],
				},
			});
			await context.secrets.store('user-parent', 'cookie-parent');
			await context.secrets.store('user-child', 'cookie-child');

			const saver = SessionManager as unknown as SessionSaver;
			await saver.saveSession(parent);
			await saver.saveSession(child);

			await SessionManager.removeSession('user-parent');

			assert.strictEqual(
				await context.secrets.get('user-parent'),
				undefined,
				"the removed session's own cookie is deleted",
			);
			assert.strictEqual(
				await context.secrets.get('user-child'),
				'cookie-child',
				"another session's user-keyed cookie survives even though its org overlaps the removed session",
			);
			assert.strictEqual(await SessionManager.getSessionForOrg('org-child'), child);
		});

		test('stops resolving the session for its orgs before any persistence completes', async () => {
			const { session } = createMockSession({
				profile: {
					user: Fixtures.userFragment({ id: 'user-race' }),
					org: { id: 'org-race', name: 'Race' },
					allManagedOrgs: [{ id: 'org-race', name: 'Race' }],
				},
			});
			const saver = SessionManager as unknown as SessionSaver;
			await saver.saveSession(session);

			const removal = SessionManager.removeSession('user-race');
			// Deliberately not awaited yet: a concurrent sync must not land on a
			// session the user has already confirmed removing.
			await assert.rejects(SessionManager.getSessionForOrg('org-race'));
			await removal;
		});
	});

	suite('expiration listener teardown', () => {
		test('disposes the onExpired listener when _resetForTesting is called', () => {
			const { session } = createMockSession({
				profile: { user: Fixtures.userFragment({ id: 'user-expiry' }) },
			});

			// Track the disposable that onExpired hands back.
			let disposeCalled = false;
			const originalOnExpired = session.onExpired.bind(session);
			Object.defineProperty(session, 'onExpired', {
				value: (listener: Parameters<typeof session.onExpired>[0]) => {
					const real = originalOnExpired(listener);
					return {
						dispose() {
							disposeCalled = true;
							real.dispose();
						},
					};
				},
				configurable: true,
			});

			SessionManager._setSessionsForTesting([session]);
			assert.strictEqual(disposeCalled, false, 'listener should not be disposed yet');

			SessionManager._resetForTesting();
			assert.strictEqual(disposeCalled, true, 'listener should be disposed after reset');
		});

		test('disposes the onExpired listener when removeSession is called', async () => {
			const { session } = createMockSession({
				profile: { user: Fixtures.userFragment({ id: 'user-expiry-remove' }) },
			});

			let disposeCalled = false;
			const originalOnExpired = session.onExpired.bind(session);
			Object.defineProperty(session, 'onExpired', {
				value: (listener: Parameters<typeof session.onExpired>[0]) => {
					const real = originalOnExpired(listener);
					return {
						dispose() {
							disposeCalled = true;
							real.dispose();
						},
					};
				},
				configurable: true,
			});

			SessionManager._setSessionsForTesting([session]);
			assert.strictEqual(disposeCalled, false, 'listener should not be disposed yet');

			await SessionManager.removeSession('user-expiry-remove');
			assert.strictEqual(disposeCalled, true, 'listener should be disposed after removeSession');
		});
	});
});
