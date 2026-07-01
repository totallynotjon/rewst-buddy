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
		test('should resolve session via org index for managed (non-primary) org', () => {
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

			assert.strictEqual(SessionManager.getSessionForOrg('managed-org'), session);
			assert.strictEqual(SessionManager.getSessionForOrg('primary-org'), session);
		});

		test('should throw for unknown org', () => {
			const { session } = createMockSession({
				profile: { allManagedOrgs: [{ id: 'org-a', name: 'A' }] },
			});
			SessionManager._setSessionsForTesting([session]);

			assert.throws(() => SessionManager.getSessionForOrg('unknown-org'));
		});

		test('should throw after clearProfiles()', async () => {
			const { session } = createMockSession({
				profile: { org: { id: 'org-a', name: 'A' }, allManagedOrgs: [{ id: 'org-a', name: 'A' }] },
			});
			SessionManager._setSessionsForTesting([session]);
			assert.strictEqual(SessionManager.getSessionForOrg('org-a'), session);

			await SessionManager.clearProfiles();

			assert.throws(() => SessionManager.getSessionForOrg('org-a'));
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
			assert.strictEqual(SessionManager.getSessionForOrg('org-b'), first);

			await saver.saveSession(second);

			assert.strictEqual(SessionManager.getSessionForOrg('org-a'), second);
			assert.throws(
				() => SessionManager.getSessionForOrg('org-b'),
				'dropped org should no longer resolve to the stale session',
			);
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
			assert.strictEqual(SessionManager.getSessionForOrg('org-create'), session);
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
			assert.strictEqual(SessionManager.getSessionForOrg('org-restore'), sessions[0]);
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
			assert.throws(() => SessionManager.getSessionForOrg('org-clear-primary'));
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
});
