import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager, Session } from '@sessions';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';

const { suite, test, setup, teardown } = Mocha;

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
});
