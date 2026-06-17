import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SlidingWindowThrottle } from './throttle';

const { suite, test } = Mocha;

suite('Unit: SlidingWindowThrottle', () => {
	test('allows up to the limit then rejects within the window', () => {
		const now = 1000;
		const throttle = new SlidingWindowThrottle(3, 1000, () => now);
		assert.strictEqual(throttle.tryAcquire(), true);
		assert.strictEqual(throttle.tryAcquire(), true);
		assert.strictEqual(throttle.tryAcquire(), true);
		assert.strictEqual(throttle.tryAcquire(), false, 'fourth call in window is rejected');
	});

	test('a rejected call is not counted, so capacity returns after the window', () => {
		let now = 0;
		const throttle = new SlidingWindowThrottle(2, 1000, () => now);
		assert.strictEqual(throttle.tryAcquire(), true);
		assert.strictEqual(throttle.tryAcquire(), true);
		assert.strictEqual(throttle.tryAcquire(), false);
		now = 1001; // window has fully elapsed
		assert.strictEqual(throttle.tryAcquire(), true, 'capacity restored after window');
	});

	test('retryAfterMs reports time until the oldest hit ages out', () => {
		let now = 0;
		const throttle = new SlidingWindowThrottle(1, 1000, () => now);
		throttle.tryAcquire();
		now = 400;
		assert.strictEqual(throttle.retryAfterMs(), 600);
		now = 2000;
		assert.strictEqual(throttle.retryAfterMs(), 0);
	});
});
