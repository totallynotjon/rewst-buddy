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

	test('detects a trigger inside a {% %}-closed span', () => {
		const line = '{% if x | up %}';
		const character = line.indexOf('up') + 2;
		const trigger = findJinjaFilterTriggerAtPosition(line, character);
		assert.ok(trigger);
		assert.strictEqual(trigger!.partial, 'up');
	});

	test('picks the enclosing span on a line with two separate Jinja spans', () => {
		const line = '{{ a | b }} text {{ c | up }}';
		const character = line.indexOf('up') + 2;
		const trigger = findJinjaFilterTriggerAtPosition(line, character);
		assert.ok(trigger);
		assert.strictEqual(trigger!.partial, 'up');
	});

	test('handles escaped quotes before a real filter pipe', () => {
		const line = '{{ "quoted \\"| value" | up }}';
		const character = line.indexOf('up') + 2;
		assert.deepStrictEqual(findJinjaFilterTriggerAtPosition(line, character), { partial: 'up' });
	});

	test('does not accept the wrong closing delimiter for an expression span', () => {
		const line = '{{ value | up %}';
		assert.strictEqual(findJinjaFilterTriggerAtPosition(line, line.indexOf('up') + 2), null);
	});

	test('supports whitespace-control delimiters', () => {
		const line = '{{- value | up -}}';
		assert.deepStrictEqual(findJinjaFilterTriggerAtPosition(line, line.indexOf('up') + 2), { partial: 'up' });
	});

	test('returns null for invalid cursor positions', () => {
		const line = '{{ value | up }}';
		assert.strictEqual(findJinjaFilterTriggerAtPosition(line, -1), null);
		assert.strictEqual(findJinjaFilterTriggerAtPosition(line, line.length + 10), null);
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

	test('finds filter name inside a {% %}-closed span', () => {
		const line = '{% if x | upper %}';
		const character = line.indexOf('upper') + 2;
		assert.strictEqual(findJinjaFilterNameAtPosition(line, character), 'upper');
	});

	test('finds underscore and numeric filter names', () => {
		const line = '{{ value | custom_filter2 }}';
		assert.strictEqual(findJinjaFilterNameAtPosition(line, line.indexOf('filter2')), 'custom_filter2');
	});

	test('does not find a filter through a mismatched span closer', () => {
		const line = '{% value | upper }}';
		assert.strictEqual(findJinjaFilterNameAtPosition(line, line.indexOf('upper')), null);
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

	test('does not highlight keyword-looking words inside string literals', () => {
		const line = `{{ "if for else" ~ 'try catch endif' }}`;
		assert.deepStrictEqual(findJinjaKeywordTokens(line), []);
	});

	test('reports exact token offsets across multiple spans', () => {
		const line = 'before {% if ready %} middle {{ [x for x in xs] }}';
		const tokens = findJinjaKeywordTokens(line);
		assert.deepStrictEqual(
			tokens.map(token => [token.keyword, line.slice(token.start, token.end)]),
			[
				['if', 'if'],
				['for', 'for'],
				['in', 'in'],
			],
		);
	});

	test('ignores Jinja comments', () => {
		assert.deepStrictEqual(findJinjaKeywordTokens('{# if for try #}'), []);
	});
});
