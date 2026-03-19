import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';
import { SessionManager } from '@sessions';
import { resolveSession } from './resolveSession';

const { suite, test, setup } = Mocha;

suite('Unit: resolveSession', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('should auto-select single session when orgId omitted', () => {
		const { session } = createMockSession();
		SessionManager._setSessionsForTesting([session]);

		const result = resolveSession();

		assert.strictEqual(result, session);
	});

	test('should throw when no sessions active', () => {
		assert.throws(
			() => resolveSession(),
			/No active Rewst sessions/,
		);
	});

	test('should throw when multiple sessions and no orgId', () => {
		const { session: s1 } = createMockSession({
			profile: {
				org: { id: 'org-1', name: 'Org One' },
				allManagedOrgs: [{ id: 'org-1', name: 'Org One' }],
				user: Fixtures.userFragment({ id: 'user-1', orgId: 'org-1' }),
			},
		});
		const { session: s2 } = createMockSession({
			profile: {
				org: { id: 'org-2', name: 'Org Two' },
				allManagedOrgs: [{ id: 'org-2', name: 'Org Two' }],
				user: Fixtures.userFragment({ id: 'user-2', orgId: 'org-2' }),
			},
		});
		SessionManager._setSessionsForTesting([s1, s2]);

		assert.throws(
			() => resolveSession(),
			/Multiple sessions active/,
		);
	});

	test('should find session by orgId', () => {
		const orgId = 'org-abc';
		const { session } = createMockSession({
			profile: {
				org: { id: orgId, name: 'Target Org' },
				allManagedOrgs: [{ id: orgId, name: 'Target Org' }],
			},
		});
		SessionManager._setSessionsForTesting([session]);

		const result = resolveSession(orgId);

		assert.strictEqual(result, session);
	});

	test('should throw when orgId not found', () => {
		const { session } = createMockSession({
			profile: {
				org: { id: 'org-1', name: 'Org One' },
				allManagedOrgs: [{ id: 'org-1', name: 'Org One' }],
			},
		});
		SessionManager._setSessionsForTesting([session]);

		assert.throws(
			() => resolveSession('org-nonexistent'),
			/No session found for org "org-nonexistent"/,
		);
	});
});
