import * as assert from 'assert';
import * as Mocha from 'mocha';
import { ContextUsageStatusBar, formatTokenCount, statusBarText, statusBarTooltip } from './ContextUsageStatusBar';
import { setContextUsage, type ContextUsage } from './chat/model/contextUsage';

const { suite, test } = Mocha;

suite('Unit: ContextUsageStatusBar', () => {
	test('formatTokenCount stays compact across magnitudes', () => {
		assert.strictEqual(formatTokenCount(950), '950');
		assert.strictEqual(formatTokenCount(16000), '16K');
		assert.strictEqual(formatTokenCount(60500), '60.5K');
		assert.strictEqual(formatTokenCount(144000), '144K');
		assert.strictEqual(formatTokenCount(128000), '128K');
	});

	test('statusBarText is a rounded percentage with an icon', () => {
		const usage: ContextUsage = { orgId: 'org-1', totalTokens: 60500, maxTokens: 144000, percent: 42 };
		assert.strictEqual(statusBarText(usage), '$(dashboard) 42%');
	});

	test('statusBarTooltip names the org and shows the token breakdown', () => {
		const usage: ContextUsage = {
			orgId: 'org-1',
			orgName: 'Test Org',
			totalTokens: 60500,
			maxTokens: 144000,
			percent: 42,
		};
		const tooltip = statusBarTooltip(usage).value;
		assert.ok(tooltip.includes('Test Org'), 'names the org');
		assert.ok(tooltip.includes('60.5K / 144K tokens'), 'shows the token breakdown');
		assert.ok(tooltip.includes('42% used'), 'shows the percentage');
	});

	test('statusBarTooltip header omits the org when no org name is given', () => {
		const header = statusBarTooltip({
			orgId: 'org-1',
			totalTokens: 1000,
			maxTokens: 144000,
			percent: 1,
		}).value.split('\n\n')[0];
		assert.strictEqual(header, '**Cage-Free Rewsty context window**');
	});

	test('subscribes to usage updates and disposes cleanly', () => {
		const statusBar = new ContextUsageStatusBar();
		assert.doesNotThrow(() =>
			setContextUsage({ orgId: 'org-1', totalTokens: 60500, maxTokens: 144000, percent: 42 }),
		);
		statusBar.dispose();
	});
});
