import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import {
	mapWithConcurrency,
	rawGraphqlOrThrow,
	requireResourceInOrg,
	requireStringAllowEmpty,
	throwOnGraphqlErrors,
} from './inputHelpers';

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Minimal Session stub — only rawGraphql is needed for these tests
// ---------------------------------------------------------------------------
function makeSession(result: { data?: unknown; errors?: unknown }) {
	return {
		rawGraphql: async (_query: string, _vars?: unknown) => result,
	} as unknown as import('@sessions').Session;
}

suite('Unit: inputHelpers — throwOnGraphqlErrors', () => {
	test('does not throw when errors is null', () => {
		assert.doesNotThrow(() => throwOnGraphqlErrors(null));
	});

	test('does not throw when errors is undefined', () => {
		assert.doesNotThrow(() => throwOnGraphqlErrors(undefined));
	});

	test('does not throw when errors is an empty array', () => {
		assert.doesNotThrow(() => throwOnGraphqlErrors([]));
	});

	test('throws when errors is a non-empty array', () => {
		assert.throws(() => throwOnGraphqlErrors([{ message: 'something went wrong' }]), /GraphQL error/);
	});

	test('throws when errors is a non-null non-array truthy value', () => {
		assert.throws(() => throwOnGraphqlErrors('unexpected error string'), /GraphQL error/);
	});

	test('serialises the errors value into the message', () => {
		const err = [{ message: 'field not found', path: ['workflow'] }];
		assert.throws(
			() => throwOnGraphqlErrors(err),
			(e: unknown) => e instanceof Error && e.message.includes('field not found'),
		);
	});
});

suite('Unit: inputHelpers — rawGraphqlOrThrow', () => {
	test('returns data on a successful response', async () => {
		const session = makeSession({ data: { workflow: { id: '123' } }, errors: null });
		const data = await rawGraphqlOrThrow(session, 'query {}');
		assert.deepStrictEqual(data, { workflow: { id: '123' } });
	});

	test('returns data when errors is undefined', async () => {
		const session = makeSession({ data: { tags: [] } });
		const data = await rawGraphqlOrThrow(session, 'query {}');
		assert.deepStrictEqual(data, { tags: [] });
	});

	test('returns data when errors is an empty array', async () => {
		const session = makeSession({ data: { tags: [] }, errors: [] });
		const data = await rawGraphqlOrThrow(session, 'query {}');
		assert.deepStrictEqual(data, { tags: [] });
	});

	test('throws when errors is a non-empty array', async () => {
		const session = makeSession({ data: null, errors: [{ message: 'not found' }] });
		await assert.rejects(() => rawGraphqlOrThrow(session, 'query {}'), /GraphQL error/);
	});

	test('throws when errors is a non-array truthy value', async () => {
		const session = makeSession({ data: null, errors: 'server error' });
		await assert.rejects(() => rawGraphqlOrThrow(session, 'query {}'), /GraphQL error/);
	});

	test('passes variables through to rawGraphql', async () => {
		let capturedVars: unknown;
		const session = {
			rawGraphql: async (_q: string, vars?: unknown) => {
				capturedVars = vars;
				return { data: {}, errors: null };
			},
		} as unknown as import('@sessions').Session;
		await rawGraphqlOrThrow(session, 'query {}', { orgId: 'abc' });
		assert.deepStrictEqual(capturedVars, { orgId: 'abc' });
	});
});

suite('Unit: inputHelpers — requireResourceInOrg', () => {
	test('returns the resource when it exists and belongs to the org', async () => {
		const row = { id: 'w1', orgId: 'org1' };
		const result = await requireResourceInOrg({
			label: 'Workflow',
			id: 'w1',
			orgId: 'org1',
			fetch: async () => row,
		});
		assert.strictEqual(result, row);
	});

	test('throws when fetch returns undefined (resource not found)', async () => {
		await assert.rejects(
			() =>
				requireResourceInOrg({
					label: 'Workflow',
					id: 'w1',
					orgId: 'org1',
					fetch: async () => undefined,
				}),
			/Workflow w1 is not in org org1/,
		);
	});

	test('throws when the resource orgId does not match (default inOrg predicate)', async () => {
		const row = { id: 'w1', orgId: 'org2' };
		await assert.rejects(
			() =>
				requireResourceInOrg({
					label: 'Workflow',
					id: 'w1',
					orgId: 'org1',
					fetch: async () => row,
				}),
			/Workflow w1 is not in org org1/,
		);
	});

	test('uses custom inOrg predicate when provided', async () => {
		const row = { id: 'w1', orgId: 'org2' };
		// inOrg: () => true bypasses the orgId check (e.g. query is already org-filtered)
		const result = await requireResourceInOrg({
			label: 'Workflow',
			id: 'w1',
			orgId: 'org1',
			fetch: async () => row,
			inOrg: () => true,
		});
		assert.strictEqual(result, row);
	});

	test('throws when custom inOrg predicate returns false', async () => {
		const row = { id: 'w1', orgId: 'org1' };
		await assert.rejects(
			() =>
				requireResourceInOrg({
					label: 'Workflow',
					id: 'w1',
					orgId: 'org1',
					fetch: async () => row,
					inOrg: () => false,
				}),
			/Workflow w1 is not in org org1/,
		);
	});

	test('error message includes label, id, and orgId', async () => {
		await assert.rejects(
			() =>
				requireResourceInOrg({
					label: 'Tag',
					id: 'tag-99',
					orgId: 'org-xyz',
					fetch: async () => undefined,
				}),
			(e: unknown) =>
				e instanceof Error &&
				e.message.includes('Tag') &&
				e.message.includes('tag-99') &&
				e.message.includes('org-xyz'),
		);
	});
});

suite('Unit: inputHelpers', () => {
	test('mapWithConcurrency preserves order', async () => {
		const result = await mapWithConcurrency([3, 1, 2], 2, async (item: number) => {
			await delay((4 - item) * 5);
			return `item-${item}`;
		});

		assert.deepStrictEqual(result, ['item-3', 'item-1', 'item-2']);
	});

	test('mapWithConcurrency never exceeds concurrency limit', async () => {
		let running = 0;
		let peak = 0;

		await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 3, async (item: number) => {
			running += 1;
			peak = Math.max(peak, running);
			assert.ok(running <= 3);
			await delay(5);
			running -= 1;
			return item;
		});

		assert.strictEqual(peak, 3);
	});

	test('mapWithConcurrency returns all results', async () => {
		const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (item: number) => item * 10);

		assert.deepStrictEqual(result, [10, 20, 30, 40]);
	});

	test('mapWithConcurrency rejects zero concurrency limit', async () => {
		await assert.rejects(
			() => mapWithConcurrency([1], 0, async (item: number) => item),
			/"limit" must be a positive integer\./,
		);
	});

	test('mapWithConcurrency rejects negative concurrency limit', async () => {
		await assert.rejects(
			() => mapWithConcurrency([1], -1, async (item: number) => item),
			/"limit" must be a positive integer\./,
		);
	});

	test('mapWithConcurrency rejects non-integer concurrency limit', async () => {
		await assert.rejects(
			() => mapWithConcurrency([1], 1.5, async (item: number) => item),
			/"limit" must be a positive integer\./,
		);
	});
});

suite('Unit: inputHelpers — requireStringAllowEmpty', () => {
	test('returns empty string for an empty-string value', () => {
		const result = requireStringAllowEmpty({ body: '' }, 'body');
		assert.strictEqual(result, '');
	});

	test('returns the string unchanged (no trimming) for a padded value', () => {
		const result = requireStringAllowEmpty({ body: '  hello  ' }, 'body');
		assert.strictEqual(result, '  hello  ');
	});

	test('throws when the key is absent', () => {
		assert.throws(() => requireStringAllowEmpty({}, 'body'), /Missing required string argument "body"/);
	});

	test('throws when the value is a non-string (number)', () => {
		assert.throws(() => requireStringAllowEmpty({ body: 42 }, 'body'), /Missing required string argument "body"/);
	});
});
