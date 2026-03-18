import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment, createMockSession } from '@test';

const { suite, test, setup } = Mocha;

suite('Unit: Session.executeRawQuery', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('should return data from rawRequest', async () => {
		const { session } = createMockSession();
		const expectedData = { user: { id: '123', username: 'test' } };

		// Stub rawRequest on the client directly
		session.client!.rawRequest = async () =>
			({
				data: expectedData,
				errors: undefined,
				headers: new Headers(),
				status: 200,
			}) as any;

		const result = await session.executeRawQuery('{ user { id username } }');
		assert.deepStrictEqual(result.data, expectedData);
		assert.strictEqual(result.errors, undefined);
	});

	test('should throw when no client is available', async () => {
		const { session } = createMockSession();
		session.client = undefined;

		await assert.rejects(() => session.executeRawQuery('{ user { id } }'), /no GraphQL client/);
	});

	test('should pass through errors from response', async () => {
		const { session } = createMockSession();
		const expectedErrors = [{ message: 'Field not found' }];

		session.client!.rawRequest = async () =>
			({
				data: null,
				errors: expectedErrors,
				headers: new Headers(),
				status: 200,
			}) as any;

		const result = await session.executeRawQuery('{ invalid }');
		assert.strictEqual(result.data, null);
		assert.deepStrictEqual(result.errors, expectedErrors);
	});

	test('should pass variables to rawRequest', async () => {
		const { session } = createMockSession();
		let capturedVars: Record<string, unknown> | undefined;

		session.client!.rawRequest = (async (...args: any[]) => {
			capturedVars = args[1];
			return {
				data: { result: true },
				errors: undefined,
				headers: new Headers(),
				status: 200,
			} as any;
		}) as any;

		const variables = { id: 'test-id', limit: 10 };
		await session.executeRawQuery('query($id: ID!, $limit: Int) { ... }', variables);
		assert.deepStrictEqual(capturedVars, variables);
	});
});
