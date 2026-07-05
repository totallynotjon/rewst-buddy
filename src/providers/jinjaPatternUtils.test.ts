import * as assert from 'assert';
import {
	findJinjaFilterNameAtPosition,
	findJinjaFilterTriggerAtPosition,
	findJinjaKeywordTokens,
} from './jinjaPatternUtils';

import { suite, test } from '../test/tdd';

suite('Unit: findJinjaFilterTriggerAtPosition()', () => {
	test('detects trigger right after a bare pipe', () => {
		const line = '{{ name | }}';
		const character = line.indexOf('|') + 1;
		const trigger = findJinjaFilterTriggerAtPosition(line, character);
		assert.ok(trigger);
		assert.strictEqual(trigger!.partial, '');
	});

	test('detects trigger with a partial filter name typed', () => {
		const line = '{{ name | up';
		const trigger = findJinjaFilterTriggerAtPosition(line, line.length);
		assert.ok(trigger);
		assert.strictEqual(trigger!.partial, 'up');
	});

	test('returns null outside any {{ }}/{% %} span', () => {
		const line = 'plain text | not jinja';
		const character = line.indexOf('|') + 1;
		assert.strictEqual(findJinjaFilterTriggerAtPosition(line, character), null);
	});

	test('returns null when the pipe sits inside a string literal', () => {
		const line = "{{ 'a|b' }}";
		const character = line.indexOf('|') + 1;
		assert.strictEqual(findJinjaFilterTriggerAtPosition(line, character), null);
	});

	test('returns null for a | elsewhere on the line outside any brace', () => {
		const line = 'some | shell-pipe-looking text';
		const character = line.indexOf('|') + 1;
		assert.strictEqual(findJinjaFilterTriggerAtPosition(line, character), null);
	});

	test('detects the last pipe in a filter chain', () => {
		const line = '{{ name | upper | tri';
		const trigger = findJinjaFilterTriggerAtPosition(line, line.length);
		assert.ok(trigger);
		assert.strictEqual(trigger!.partial, 'tri');
	});
});

suite('Unit: findJinjaFilterNameAtPosition()', () => {
	test('finds filter name when cursor is within it', () => {
		const line = '{{ name | upper }}';
		const character = line.indexOf('upper') + 2;
		assert.strictEqual(findJinjaFilterNameAtPosition(line, character), 'upper');
	});

	test('returns null when cursor is on the variable name, not the filter', () => {
		const line = '{{ name | upper }}';
		const character = line.indexOf('name') + 2;
		assert.strictEqual(findJinjaFilterNameAtPosition(line, character), null);
	});

	test('returns null outside any Jinja span', () => {
		const line = 'upper case text';
		const character = line.indexOf('upper') + 2;
		assert.strictEqual(findJinjaFilterNameAtPosition(line, character), null);
	});
});

suite('Unit: findJinjaKeywordTokens()', () => {
	test('finds try/catch keywords inside a {% %} block', () => {
		const line = '{% try %}...{% catch %}...{% endtry %}';
		const tokens = findJinjaKeywordTokens(line).map(t => t.keyword);
		assert.deepStrictEqual(tokens, ['try', 'catch', 'endtry']);
	});

	test('finds for/in/if keywords inside a comprehension', () => {
		const line = '{{ [x for x in y if x] }}';
		const tokens = findJinjaKeywordTokens(line).map(t => t.keyword);
		assert.deepStrictEqual(tokens, ['for', 'in', 'if']);
	});

	test('does not flag for/if occurring in plain prose outside any span', () => {
		const line = 'for the record, if possible';
		assert.deepStrictEqual(findJinjaKeywordTokens(line), []);
	});

	test('does not flag keywords as substrings of identifiers', () => {
		const line = '{{ forms }}';
		assert.deepStrictEqual(findJinjaKeywordTokens(line), []);
	});
});
