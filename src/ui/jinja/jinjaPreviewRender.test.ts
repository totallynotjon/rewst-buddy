/**
 * Unit tests for the pure Jinja-preview render helpers: overrides parsing,
 * base+override merge semantics, and rendered-pane content formatting.
 *
 * Runner: vitest (pure — no vscode import).
 */

import * as assert from 'assert';
import { suite, test } from '../../test/tdd';
import {
	formatInvalidOverrides,
	formatRenderedError,
	formatRenderedSuccess,
	mergeVars,
	OVERRIDES_SEED,
	parseOverrides,
	previewBaseName,
} from './jinjaPreviewRender';

suite('Unit: jinjaPreviewRender', () => {
	suite('parseOverrides()', () => {
		test('empty/whitespace text parses to an empty object', () => {
			assert.deepStrictEqual(parseOverrides(''), { vars: {} });
			assert.deepStrictEqual(parseOverrides('   \n  '), { vars: {} });
		});

		test('a valid JSON object parses to its vars', () => {
			assert.deepStrictEqual(parseOverrides('{"a": 1, "b": "two"}'), { vars: { a: 1, b: 'two' } });
		});

		test('strips full-line // comments before parsing (jsonc-lite)', () => {
			const text = ['// Add overrides here', '// Example: { "myVar": "value" }', '{"a": 1}'].join('\n');
			assert.deepStrictEqual(parseOverrides(text), { vars: { a: 1 } });
		});

		test('invalid JSON returns an error, not a throw', () => {
			const result = parseOverrides('{ not json');
			assert.strictEqual(result.vars, undefined);
			assert.ok(result.error);
		});

		test('a non-object JSON value (array/number/string) is rejected with an error', () => {
			assert.ok(parseOverrides('[1,2,3]').error);
			assert.ok(parseOverrides('42').error);
			assert.ok(parseOverrides('"just a string"').error);
		});

		test('OVERRIDES_SEED itself parses cleanly to an empty object', () => {
			assert.deepStrictEqual(parseOverrides(OVERRIDES_SEED), { vars: {} });
		});
	});

	suite('mergeVars()', () => {
		test('overrides win on a shared key, base keys are preserved otherwise', () => {
			assert.deepStrictEqual(mergeVars({ a: 1, b: 2 }, { b: 99 }), { a: 1, b: 99 });
		});

		test('undefined base is treated as empty', () => {
			assert.deepStrictEqual(mergeVars(undefined, { a: 1 }), { a: 1 });
		});
	});

	suite('formatRenderedSuccess()', () => {
		test('pretty-prints a non-string value as JSON with no warning by default', () => {
			const content = formatRenderedSuccess({ x: 1 }, false);
			assert.strictEqual(content, JSON.stringify({ x: 1 }, null, 2));
		});

		test('renders a string value raw — real newlines and quotes, not JSON-escaped', () => {
			const value = 'stuffadsfsadkjsafks asdfsdf\n019f3437-dba3-7fbe-8998-f2b703f74393\n';
			const content = formatRenderedSuccess(value, false);
			assert.strictEqual(content, value);
			assert.ok(!content.includes('\\n'), 'newlines must render literally, not as the two characters \\n');
		});

		test('prepends a control-character warning comment when flagged', () => {
			const content = formatRenderedSuccess('hello', true);
			assert.ok(content.startsWith('// WARNING'));
			assert.ok(content.includes('hello'));
			assert.ok(!content.includes('"hello"'), 'a string result should not be JSON-quoted');
		});
	});

	suite('formatRenderedError() / formatInvalidOverrides()', () => {
		test('both render as a single comment line, not valid JSON', () => {
			assert.strictEqual(formatRenderedError('boom'), '// Error: boom');
			assert.strictEqual(formatInvalidOverrides('bad json'), '// Invalid overrides JSON: bad json');
		});
	});

	suite('previewBaseName()', () => {
		test('uses the template name plus a short id suffix', () => {
			assert.strictEqual(
				previewBaseName('019f3437-dba3-7fbe-8998-f2b703f74393', 'My Template'),
				'My Template (019f3437)',
			);
		});

		test('sanitizes path-unsafe characters in the name', () => {
			assert.strictEqual(previewBaseName('abc12345', 'a/b:c*d?e'), 'a b c d e (abc12345)');
		});

		test('collapses repeated whitespace and trims', () => {
			assert.strictEqual(previewBaseName('abc12345', '  spaced   out  '), 'spaced out (abc12345)');
		});

		test('falls back to "template" for an empty/whitespace-only name', () => {
			assert.strictEqual(previewBaseName('abc12345', '   '), 'template (abc12345)');
		});

		test('two different template ids with the same name stay distinct', () => {
			const a = previewBaseName('id-one-11111111', 'Shared Name');
			const b = previewBaseName('id-two-22222222', 'Shared Name');
			assert.notStrictEqual(a, b);
		});
	});
});
