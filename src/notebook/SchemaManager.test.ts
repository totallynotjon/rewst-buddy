import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment, createMockSession } from '@test';
import { SessionManager } from '@sessions';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: SchemaManager', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
	});

	test('should have executeRawQuery available on mock session for introspection', async () => {
		const { session } = createMockSession();

		// Simulate introspection response
		session.client!.rawRequest = async () =>
			({
				data: {
					__schema: {
						types: [{ name: 'Query' }],
					},
				},
				errors: undefined,
				headers: new Headers(),
				status: 200,
			}) as any;

		const result = await session.executeRawQuery('{ __schema { types { name } } }');
		assert.ok(result.data);
		assert.deepStrictEqual((result.data as any).__schema.types[0].name, 'Query');
	});

	test('should handle introspection error gracefully', async () => {
		const { session } = createMockSession();

		session.client!.rawRequest = async () => {
			throw new Error('Network error');
		};

		await assert.rejects(() => session.executeRawQuery('{ __schema { types { name } } }'), /Network error/);
	});
});
