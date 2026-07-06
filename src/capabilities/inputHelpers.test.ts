import * as assert from 'assert';
import { z } from 'zod';
import { suite, test } from '../test/tdd';
import {
	mapWithConcurrency,
	optionalClampedInt,
	optionalStringField,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requireResourceInOrg,
	requireStringAllowEmpty,
	requiredStringField,
	throwOnGraphqlErrors,
	toInputSchema,
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

	test('throws when the resource row has no orgId field (default inOrg predicate)', async () => {
		const row = { id: 'w1' };
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

// ---------------------------------------------------------------------------
// New Zod-based helpers
// ---------------------------------------------------------------------------

suite('Unit: inputHelpers — parseCapabilityInput', () => {
	test('returns parsed data on success', () => {
		const schema = z.object({ a: z.string() });
		const result = parseCapabilityInput(schema, { a: 'x' });
		assert.deepStrictEqual(result, { a: 'x' });
	});

	test('throws the first issue message, not the raw ZodError JSON', () => {
		const schema = z.object({ a: z.string({ error: 'Missing required string argument "a".' }) });
		let thrown: unknown;
		try {
			parseCapabilityInput(schema, {});
		} catch (e) {
			thrown = e;
		}
		assert.ok(thrown instanceof Error, 'should throw an Error');
		const msg = (thrown as Error).message;
		// Must be a clean single-line message, not a JSON blob
		assert.match(msg, /^Missing/);
		assert.ok(!msg.includes('"code"'), 'message must not contain JSON "code" key');
		assert.ok(!msg.startsWith('['), 'message must not start with [ (JSON array)');
	});
});

suite('Unit: inputHelpers — requiredStringField', () => {
	test('rejects missing key with the keyed message', () => {
		const schema = z.object({ x: requiredStringField('x') });
		assert.throws(() => parseCapabilityInput(schema, {}), /Missing required string argument "x"\./);
	});

	test('rejects wrong type (number) with the keyed message', () => {
		const schema = z.object({ x: requiredStringField('x') });
		assert.throws(() => parseCapabilityInput(schema, { x: 123 }), /Missing required string argument "x"\./);
	});

	test('rejects empty string with the keyed message', () => {
		const schema = z.object({ x: requiredStringField('x') });
		assert.throws(() => parseCapabilityInput(schema, { x: '' }), /Missing required string argument "x"\./);
	});

	test('rejects whitespace-only string with the keyed message', () => {
		const schema = z.object({ x: requiredStringField('x') });
		assert.throws(() => parseCapabilityInput(schema, { x: '   ' }), /Missing required string argument "x"\./);
	});

	test('trims and accepts a valid string', () => {
		const schema = z.object({ x: requiredStringField('x') });
		const result = parseCapabilityInput(schema, { x: '  hi  ' });
		assert.strictEqual(result.x, 'hi');
	});
});

suite('Unit: inputHelpers — optionalStringField', () => {
	test('resolves undefined for missing key (no throw)', () => {
		const schema = z.object({ x: optionalStringField() });
		const result = parseCapabilityInput(schema, {});
		assert.strictEqual(result.x, undefined);
	});

	test('resolves undefined for wrong type (number, no throw)', () => {
		const schema = z.object({ x: optionalStringField() });
		const result = parseCapabilityInput(schema, { x: 123 });
		assert.strictEqual(result.x, undefined);
	});

	test('resolves undefined for empty string (no throw)', () => {
		const schema = z.object({ x: optionalStringField() });
		const result = parseCapabilityInput(schema, { x: '' });
		assert.strictEqual(result.x, undefined);
	});

	test('resolves undefined for whitespace-only string (no throw)', () => {
		const schema = z.object({ x: optionalStringField() });
		const result = parseCapabilityInput(schema, { x: '   ' });
		assert.strictEqual(result.x, undefined);
	});

	test('resolves undefined for null (no throw)', () => {
		const schema = z.object({ x: optionalStringField() });
		const result = parseCapabilityInput(schema, { x: null });
		assert.strictEqual(result.x, undefined);
	});

	test('trims and accepts a valid string', () => {
		const schema = z.object({ x: optionalStringField() });
		const result = parseCapabilityInput(schema, { x: '  hi  ' });
		assert.strictEqual(result.x, 'hi');
	});
});

suite('Unit: inputHelpers — optionalClampedInt', () => {
	test('resolves undefined for 0 (no throw)', () => {
		const schema = z.object({ n: optionalClampedInt(500) });
		const result = parseCapabilityInput(schema, { n: 0 });
		assert.strictEqual(result.n, undefined);
	});

	test('resolves undefined for a negative value (no throw)', () => {
		const schema = z.object({ n: optionalClampedInt(500) });
		const result = parseCapabilityInput(schema, { n: -5 });
		assert.strictEqual(result.n, undefined);
	});

	test('resolves undefined for a non-number string (no throw)', () => {
		const schema = z.object({ n: optionalClampedInt(500) });
		const result = parseCapabilityInput(schema, { n: '10' });
		assert.strictEqual(result.n, undefined);
	});

	test('resolves undefined for a floor-to-zero fraction (0.5, no throw)', () => {
		const schema = z.object({ n: optionalClampedInt(500) });
		const result = parseCapabilityInput(schema, { n: 0.5 });
		assert.strictEqual(result.n, undefined);
	});

	test('floors a fractional value instead of rejecting it', () => {
		const schema = z.object({ n: optionalClampedInt(500) });
		const result = parseCapabilityInput(schema, { n: 2.5 });
		assert.strictEqual(result.n, 2);
	});

	test('clamps an over-max value instead of rejecting it', () => {
		const schema = z.object({ n: optionalClampedInt(500) });
		const result = parseCapabilityInput(schema, { n: 999 });
		assert.strictEqual(result.n, 500);
	});

	test('passes through a valid in-range value unchanged', () => {
		const schema = z.object({ n: optionalClampedInt(500) });
		const result = parseCapabilityInput(schema, { n: 42 });
		assert.strictEqual(result.n, 42);
	});
});

suite('Unit: inputHelpers — toInputSchema', () => {
	test('strips the $schema key', () => {
		const schema = z.object({ a: z.string() });
		const result = toInputSchema(schema) as Record<string, unknown>;
		assert.ok(!('$schema' in result), '$schema must be stripped');
	});

	test('derives type and required from the schema', () => {
		const schema = z.object({
			requiredField: z.string(),
			optionalField: z.string().optional(),
		});
		const result = toInputSchema(schema) as {
			properties: Record<string, { type: string }>;
			required?: string[];
		};
		assert.ok(Array.isArray(result.required), 'required should be an array');
		assert.ok(result.required!.includes('requiredField'), 'requiredField must be in required');
		assert.ok(!result.required!.includes('optionalField'), 'optionalField must not be in required');
		assert.strictEqual(result.properties['requiredField'].type, 'string');
		assert.strictEqual(result.properties['optionalField'].type, 'string');
	});
});
