import * as assert from 'assert';
import { mapWithConcurrency } from './inputHelpers';
import { suite, test } from '../test/tdd';

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

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
