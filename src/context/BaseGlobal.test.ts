import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import { createGlobal } from './BaseGlobal';

interface ExampleGlobal {
	value: number;
	label: string;
	increment(by: number): number;
}

function example(value: number, label = 'first'): ExampleGlobal {
	return {
		value,
		label,
		increment(by: number) {
			this.value += by;
			return this.value;
		},
	};
}

suite('Unit: createGlobal()', () => {
	test('reports its initialization state without requiring initialization', () => {
		const global = createGlobal<ExampleGlobal>();
		assert.strictEqual(global.isInitialized, false);

		global.init(example(1));

		assert.strictEqual(global.isInitialized, true);
	});

	test('throws a useful error when a property is read or written before init', () => {
		const global = createGlobal<ExampleGlobal>();
		assert.throws(() => global.value, /Global object not initialized/);
		assert.throws(() => {
			global.value = 2;
		}, /Global object not initialized/);
	});

	test('delegates property reads and writes to the initialized instance', () => {
		const instance = example(1);
		const global = createGlobal<ExampleGlobal>();
		global.init(instance);

		assert.strictEqual(global.value, 1);
		global.label = 'changed';

		assert.strictEqual(instance.label, 'changed');
		assert.strictEqual(global.label, 'changed');
	});

	test('binds delegated methods to their owning instance', () => {
		const instance = example(4);
		const global = createGlobal<ExampleGlobal>();
		global.init(instance);
		const detachedIncrement = global.increment;

		assert.strictEqual(detachedIncrement(3), 7);
		assert.strictEqual(instance.value, 7);
	});

	test('reinitialization switches all subsequent reads and method calls to the new instance', () => {
		const first = example(1, 'first');
		const second = example(10, 'second');
		const global = createGlobal<ExampleGlobal>();
		global.init(first);
		global.value = 2;

		global.init(second);

		assert.strictEqual(global.label, 'second');
		assert.strictEqual(global.increment(5), 15);
		assert.strictEqual(first.value, 2);
		assert.strictEqual(second.value, 15);
	});
});
