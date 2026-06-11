import * as assert from 'assert';
import * as Mocha from 'mocha';
import { prependInstructions } from './promptContext';

const { suite, test } = Mocha;

suite('Unit: promptContext', () => {
	suite('prependInstructions()', () => {
		test('prepends trimmed instructions', () => {
			const result = prependInstructions('hello', '  be brief  ');
			assert.match(result, /^User's standing instructions: be brief/);
			assert.match(result, /hello$/);
		});

		test('returns the message untouched without instructions', () => {
			assert.strictEqual(prependInstructions('hello', undefined), 'hello');
			assert.strictEqual(prependInstructions('hello', '   '), 'hello');
		});
	});
});
