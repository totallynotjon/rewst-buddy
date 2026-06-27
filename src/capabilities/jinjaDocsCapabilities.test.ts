import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import type { CapabilityContext } from './Capability';
import {
	JINJA_DOCS_CAPABILITIES,
	formatJinjaFilters,
	parseJinjaFilters,
	_resetJinjaFilterCacheForTesting,
	_resetJinjaFilterFetcherForTesting,
	_setJinjaFilterFetcherForTesting,
	type JinjaFilterDoc,
} from './jinjaDocsCapabilities';

const { suite, test, setup, teardown } = Mocha;
const { fakeCtx, cap } = createCapabilityTestHarness(JINJA_DOCS_CAPABILITIES);

const SAMPLE_PAYLOAD = [
	{
		kind: 1,
		label: { label: 'abs' },
		insertText: 'abs',
		detail: 'abs filter',
		documentation: { value: 'Return the absolute value of the argument.' },
	},
	{
		kind: 1,
		label: { label: 'center', detail: '(width=80)' },
		insertText: 'center',
		detail: 'center filter',
		documentation: { value: 'Centers the value in a field of a given width.' },
	},
	{
		kind: 1,
		label: 'upper',
		insertText: 'upper',
		documentation: 'Convert a value to uppercase.',
	},
];

function ctxWithRegion(graphqlUrl: string): CapabilityContext {
	const session = { profile: { region: { graphqlUrl } } } as unknown as CapabilityContext['session'];
	return { session, orgId: 'org-1', sessions: [session] };
}

suite('Unit: jinjaDocsCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetJinjaFilterCacheForTesting();
		_resetJinjaFilterFetcherForTesting();
	});

	teardown(() => {
		_resetJinjaFilterCacheForTesting();
		_resetJinjaFilterFetcherForTesting();
	});

	suite('parseJinjaFilters()', () => {
		test('parses names, signatures, and documentation; sorts by name', () => {
			const filters = parseJinjaFilters(SAMPLE_PAYLOAD);
			assert.deepStrictEqual(
				filters.map(f => f.name),
				['abs', 'center', 'upper'],
			);
			const center = filters.find(f => f.name === 'center')!;
			assert.strictEqual(center.signature, '(width=80)');
			assert.strictEqual(center.documentation, 'Centers the value in a field of a given width.');
		});

		test('reads string label and string documentation forms', () => {
			const filters = parseJinjaFilters(SAMPLE_PAYLOAD);
			const upper = filters.find(f => f.name === 'upper')!;
			assert.strictEqual(upper.signature, undefined);
			assert.strictEqual(upper.documentation, 'Convert a value to uppercase.');
		});

		test('skips malformed entries without a name', () => {
			const filters = parseJinjaFilters([null, 42, {}, { label: {} }, { label: { label: 'ok' } }]);
			assert.deepStrictEqual(
				filters.map(f => f.name),
				['ok'],
			);
		});

		test('throws when payload is not an array', () => {
			assert.throws(() => parseJinjaFilters({ not: 'an array' }));
		});
	});

	suite('formatJinjaFilters()', () => {
		const filters: JinjaFilterDoc[] = parseJinjaFilters(SAMPLE_PAYLOAD);

		test('no arguments lists every filter name with signature, compactly', () => {
			const output = formatJinjaFilters(filters, {});
			assert.ok(output.includes('3 Jinja filters'));
			assert.ok(output.includes('abs'));
			assert.ok(output.includes('center(width=80)'));
			assert.ok(output.includes('upper'));
			// Compact list, not full docs.
			assert.ok(!output.includes('Centers the value in a field'));
		});

		test('name lookup returns full documentation, case-insensitively', () => {
			const output = formatJinjaFilters(filters, { name: 'CENTER' });
			assert.ok(output.includes('center(width=80)'));
			assert.ok(output.includes('Centers the value in a field of a given width.'));
			// Only the matched filter, not the others.
			assert.ok(!output.includes('absolute value'));
		});

		test('name lookup miss reports not found', () => {
			const output = formatJinjaFilters(filters, { name: 'does_not_exist' });
			assert.ok(/not found/i.test(output));
			assert.ok(output.includes('does_not_exist'));
		});

		test('search matches by name and by documentation text', () => {
			const byName = formatJinjaFilters(filters, { search: 'abs' });
			assert.ok(byName.includes('abs'));
			assert.ok(byName.includes('absolute value'));

			const byDoc = formatJinjaFilters(filters, { search: 'uppercase' });
			assert.ok(byDoc.includes('upper'));
			assert.ok(byDoc.includes('Convert a value to uppercase.'));
		});

		test('search miss reports no matches', () => {
			const output = formatJinjaFilters(filters, { search: 'zzzznope' });
			assert.ok(/no .*match/i.test(output));
		});

		test('name takes precedence over search when both supplied', () => {
			const output = formatJinjaFilters(filters, { name: 'abs', search: 'center' });
			assert.ok(output.includes('absolute value'));
			assert.ok(!output.includes('Centers the value'));
		});
	});

	suite('get_jinja_filter_docs capability', () => {
		test('is a read-only, MCP-exposed, org-agnostic capability', () => {
			const capability = cap('get_jinja_filter_docs');
			assert.strictEqual(capability.access, 'read');
			assert.strictEqual(capability.mcp, true);
			assert.strictEqual(capability.requiresOrg, false);
		});

		test('fetches filters and formats them', async () => {
			_setJinjaFilterFetcherForTesting(async () => parseJinjaFilters(SAMPLE_PAYLOAD));
			const { ctx } = fakeCtx({});
			const output = await cap('get_jinja_filter_docs').run({ name: 'abs' }, ctx);
			assert.ok(output.includes('Return the absolute value of the argument.'));
		});

		test('caches the fetched filters across calls', async () => {
			let fetchCount = 0;
			_setJinjaFilterFetcherForTesting(async () => {
				fetchCount++;
				return parseJinjaFilters(SAMPLE_PAYLOAD);
			});
			const { ctx } = fakeCtx({});
			await cap('get_jinja_filter_docs').run({}, ctx);
			await cap('get_jinja_filter_docs').run({ name: 'center' }, ctx);
			assert.strictEqual(fetchCount, 1);
		});

		test('derives the engine host from the region api host', async () => {
			let seenBase = '';
			_setJinjaFilterFetcherForTesting(async base => {
				seenBase = base;
				return parseJinjaFilters(SAMPLE_PAYLOAD);
			});
			await cap('get_jinja_filter_docs').run({}, ctxWithRegion('https://api.rewst.io/graphql'));
			assert.strictEqual(seenBase, 'https://engine.rewst.io');
		});

		test('falls back to the default engine host when the region is unknown', async () => {
			let seenBase = '';
			_setJinjaFilterFetcherForTesting(async base => {
				seenBase = base;
				return parseJinjaFilters(SAMPLE_PAYLOAD);
			});
			const { ctx } = fakeCtx({});
			await cap('get_jinja_filter_docs').run({}, ctx);
			assert.strictEqual(seenBase, 'https://engine.rewst.io');
		});
	});
});
