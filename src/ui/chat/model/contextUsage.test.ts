import * as assert from 'assert';
import * as Mocha from 'mocha';
import { currentContextUsage, onDidChangeContextUsage, setContextUsage, type ContextUsage } from './contextUsage';

const { suite, test } = Mocha;

suite('Unit: contextUsage', () => {
	test('setContextUsage updates the current value and fires the event', () => {
		const seen: ContextUsage[] = [];
		const subscription = onDidChangeContextUsage(usage => seen.push(usage));
		try {
			const usage: ContextUsage = {
				orgId: 'org-1',
				orgName: 'Test Org',
				totalTokens: 60500,
				maxTokens: 144000,
				percent: 42,
			};
			setContextUsage(usage);

			assert.deepStrictEqual(currentContextUsage(), usage);
			assert.deepStrictEqual(seen, [usage]);
		} finally {
			subscription.dispose();
		}
	});

	test('keeps the most recent usage', () => {
		setContextUsage({ orgId: 'org-1', totalTokens: 1000, maxTokens: 144000, percent: 1 });
		setContextUsage({ orgId: 'org-2', totalTokens: 72000, maxTokens: 144000, percent: 50 });
		assert.strictEqual(currentContextUsage()?.orgId, 'org-2');
		assert.strictEqual(currentContextUsage()?.percent, 50);
	});
});
