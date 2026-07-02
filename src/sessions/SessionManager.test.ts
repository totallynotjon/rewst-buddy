import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import vscode from 'vscode';
import { context } from '@global';
import { SessionManager, Session } from '@sessions';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';
import SessionProfile from './SessionProfile';

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
			// Answers a GET (refreshToken's login request) with a fresh cookie, and
			// a POST (the User() query re-validating the refreshed SDK) with a user.
			const server = createServer((request, response) => {
				if (request.method === 'GET') {
					response.writeHead(200, { 'set-cookie': 'appSession=refreshed-cookie' });
					response.end();
					return;
				}
				let body = '';
				request.on('data', chunk => {
					body += String(chunk);
				});
				request.on('end', () => {
					response.writeHead(200, { 'content-type': 'application/json' });
					response.end(JSON.stringify({ data: { user: { id: 'user-recovers' } } }));
				});
			});
			const port = await listen(server);

			try {
				await context.secrets.store(orgId, 'appSession=stale-cookie');
				const profile: SessionProfile = {
					region: {
						name: 'Local Test',
						cookieName: 'appSession',
						graphqlUrl: `http://127.0.0.1:${port}/graphql`,
						loginUrl: `http://127.0.0.1:${port}`,
					},
					org: { id: orgId, name: 'Recovers Via Refresh' },
					allManagedOrgs: [{ id: orgId, name: 'Recovers Via Refresh' }],
					label: 'Recovers Via Refresh Session',
					user: { id: 'user-recovers' } as SessionProfile['user'],
				};
				// No sdk yet: validate() fails immediately, exactly like a session
				// whose cached User() query previously failed.
				const session = new Session(undefined, profile);
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
			assert.strictEqual(await context.secrets.get('org-create'), 'appSession=raw-test-token');
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
	});

	suite('removeSession()', () => {
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
			await context.secrets.store('org-remove-primary', 'cookie-primary');
			await context.secrets.store('org-remove-managed', 'cookie-managed');

			const saver = SessionManager as unknown as SessionSaver;
			await saver.saveSession(session);
			assert.strictEqual(SessionManager.getAllKnownProfiles().length, 1);

			await SessionManager.removeSession('user-remove');

			assert.strictEqual(await context.secrets.get('org-remove-primary'), undefined);
			assert.strictEqual(await context.secrets.get('org-remove-managed'), undefined);
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
	});
});
