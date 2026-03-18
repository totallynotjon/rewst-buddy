import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment, createMockSession } from '@test';
import { SessionManager } from '@sessions';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: PlaygroundController', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
	});

	test('should resolve single session without prompting', () => {
		const { session } = createMockSession();
		SessionManager._setSessionsForTesting([session]);

		const sessions = SessionManager.getActiveSessions();
		assert.strictEqual(sessions.length, 1);
		assert.strictEqual(sessions[0], session);
	});

	test('should have no sessions when none are set', () => {
		const sessions = SessionManager.getActiveSessions();
		assert.strictEqual(sessions.length, 0);
	});

	test('session executeRawQuery should be callable via mock', async () => {
		const { session } = createMockSession();
		const expectedData = { templates: [] };

		session.client!.rawRequest = async () =>
			({
				data: expectedData,
				errors: undefined,
				headers: new Headers(),
				status: 200,
			}) as any;

		SessionManager._setSessionsForTesting([session]);

		const result = await session.executeRawQuery('{ templates { id } }');
		assert.deepStrictEqual(result.data, expectedData);
	});
});
