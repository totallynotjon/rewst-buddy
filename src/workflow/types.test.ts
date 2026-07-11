import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import {
	asObject,
	firstErrorMessage,
	isPlainObject,
	isSuccessCondition,
	normalizePublish,
	orderTransitionsByCondition,
	str,
	type RawTask,
} from './types';

suite('Unit: workflow wire-shape helpers', () => {
	suite('firstErrorMessage()', () => {
		test('returns the first GraphQL error message', () => {
			assert.strictEqual(firstErrorMessage({ errors: [{ message: 'first' }, { message: 'second' }] }), 'first');
		});

		test('falls back to serialized error details when message is absent or non-string', () => {
			assert.strictEqual(firstErrorMessage({ errors: [{ code: 'DENIED' }] }), '{"code":"DENIED"}');
			assert.strictEqual(firstErrorMessage({ errors: [{ message: 403 }] }), '{"message":403}');
		});

		test('treats missing, null, non-array, and empty errors as success', () => {
			assert.strictEqual(firstErrorMessage({}), undefined);
			assert.strictEqual(firstErrorMessage({ errors: null }), undefined);
			assert.strictEqual(firstErrorMessage({ errors: 'gateway failure' }), undefined);
			assert.strictEqual(firstErrorMessage({ errors: [] }), undefined);
		});
	});

	suite('normalizePublish()', () => {
		test('normalizes every supported wire representation without losing values', () => {
			assert.deepStrictEqual(normalizePublish({ alpha: 1, beta: false }), [
				{ key: 'alpha', value: 1 },
				{ key: 'beta', value: false },
			]);
			assert.deepStrictEqual(normalizePublish([{ alpha: '{{ CTX.a }}' }, { beta: null }]), [
				{ key: 'alpha', value: '{{ CTX.a }}' },
				{ key: 'beta', value: null },
			]);
			assert.deepStrictEqual(normalizePublish([{ key: 'alpha', value: '' }]), [{ key: 'alpha', value: '' }]);
		});

		test('skips null and primitive array entries while retaining valid neighbors', () => {
			assert.deepStrictEqual(normalizePublish([null, 'bad', 7, { key: 'ok', value: true }]), [
				{ key: 'ok', value: true },
			]);
		});

		test('returns an empty list for nullish and primitive top-level input', () => {
			assert.deepStrictEqual(normalizePublish(undefined), []);
			assert.deepStrictEqual(normalizePublish(null), []);
			assert.deepStrictEqual(normalizePublish('not-a-publish-map'), []);
		});
	});

	suite('object and string coercion', () => {
		test('isPlainObject accepts records and rejects arrays, null, and primitives', () => {
			assert.strictEqual(isPlainObject({}), true);
			assert.strictEqual(isPlainObject(Object.create(null)), true);
			assert.strictEqual(isPlainObject([]), false);
			assert.strictEqual(isPlainObject(null), false);
			assert.strictEqual(isPlainObject('value'), false);
		});

		test('asObject returns records and safely collapses all other common input shapes', () => {
			const record = { id: 'wf-1' };
			assert.strictEqual(asObject(record), record);
			assert.deepStrictEqual(asObject(null), {});
			assert.deepStrictEqual(asObject(['wf-1']), {});
			assert.deepStrictEqual(asObject('wf-1'), {});
		});

		test('str accepts only non-empty strings and preserves meaningful whitespace', () => {
			assert.strictEqual(str('workflow'), 'workflow');
			assert.strictEqual(str('  workflow  '), '  workflow  ');
			assert.strictEqual(str(''), undefined);
			assert.strictEqual(str(0), undefined);
			assert.strictEqual(str(null), undefined);
		});
	});

	suite('transition condition handling', () => {
		test('recognizes supported spellings of the success catch-all', () => {
			for (const condition of [
				undefined,
				null,
				'',
				'   ',
				'{{ SUCCEEDED }}',
				'{{SUCCEEDED}}',
				'{{ succeeded }}',
			]) {
				assert.strictEqual(isSuccessCondition(condition), true, String(condition));
			}
		});

		test('does not mistake compound or custom conditions for the success catch-all', () => {
			for (const condition of [
				'{{ FAILED }}',
				'{{ SUCCEEDED and CTX.ready }}',
				'SUCCEEDED()',
				'{{ not SUCCEEDED }}',
			]) {
				assert.strictEqual(isSuccessCondition(condition), false, condition);
			}
		});

		test('stable-partitions custom transitions before success transitions', () => {
			const customA = { id: 'custom-a', when: '{{ CTX.a }}' };
			const successA = { id: 'success-a', when: '{{ SUCCEEDED }}' };
			const customB = { id: 'custom-b', when: '{{ CTX.b }}' };
			const successB = { id: 'success-b', when: '' };
			const task = { id: 'task', name: 'Task', next: [successA, customA, successB, customB] } as RawTask;

			orderTransitionsByCondition([task]);

			assert.deepStrictEqual(task.next, [customA, customB, successA, successB]);
		});

		test('leaves absent, singleton, and all-custom transition lists unchanged', () => {
			const absent = { id: 'a', name: 'Absent' } as RawTask;
			const singletonNext = [{ id: 'only', when: '{{ SUCCEEDED }}' }];
			const singleton = { id: 'b', name: 'Singleton', next: singletonNext } as RawTask;
			const allCustomNext = [{ when: '{{ CTX.a }}' }, { when: '{{ CTX.b }}' }];
			const allCustom = { id: 'c', name: 'Custom', next: allCustomNext } as RawTask;

			orderTransitionsByCondition([absent, singleton, allCustom]);

			assert.strictEqual(singleton.next, singletonNext);
			assert.strictEqual(allCustom.next, allCustomNext);
		});
	});
});
