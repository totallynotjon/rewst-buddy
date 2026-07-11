import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import { parseCookieString } from './parseCookieString';

suite('Unit: parseCookieString()', () => {
	test('parses multiple cookies and ignores separator whitespace', () => {
		assert.deepStrictEqual(parseCookieString('session=abc; theme=dark; flag=yes'), {
			session: 'abc',
			theme: 'dark',
			flag: 'yes',
		});
	});

	test('preserves equals signs inside a cookie value', () => {
		assert.deepStrictEqual(parseCookieString('session=header.payload=signature; mode=full'), {
			session: 'header.payload=signature',
			mode: 'full',
		});
	});

	test('preserves an explicitly empty cookie value', () => {
		assert.deepStrictEqual(parseCookieString('session=; theme=dark'), {
			session: '',
			theme: 'dark',
		});
	});

	test('ignores empty segments and segments without a cookie name', () => {
		assert.deepStrictEqual(parseCookieString(';; =value; malformed; valid=1;;'), { valid: '1' });
	});

	test('uses the last value when a cookie name occurs more than once', () => {
		assert.deepStrictEqual(parseCookieString('session=old; session=new'), { session: 'new' });
	});

	test('does not decode percent escapes or plus signs implicitly', () => {
		assert.deepStrictEqual(parseCookieString('return=%2Fhome%3Fa%3D1; token=a+b'), {
			return: '%2Fhome%3Fa%3D1',
			token: 'a+b',
		});
	});

	test('handles object-prototype cookie names as ordinary data keys', () => {
		const cookies = parseCookieString('__proto__=session-value; constructor=ctor-value');

		assert.strictEqual(Object.prototype.hasOwnProperty.call(cookies, '__proto__'), true);
		assert.strictEqual(cookies.__proto__, 'session-value');
		assert.strictEqual(cookies.constructor, 'ctor-value');
		assert.strictEqual(Object.getPrototypeOf({}), Object.prototype, 'global object prototype is unchanged');
	});

	test('returns an empty record for an empty or delimiter-only header', () => {
		assert.deepStrictEqual(parseCookieString(''), {});
		assert.deepStrictEqual(parseCookieString(' ; ; '), {});
	});
});
