import * as assert from 'assert';
import { suite, test } from '../../../test/tdd';
import { getLastAiAnswer, setLastAiAnswer } from './lastAnswer';
import { renderSourcesMarkdown } from './sources';

suite('Unit: AI answer state and source rendering', () => {
	suite('last answer state', () => {
		test('returns the most recently completed answer verbatim', () => {
			setLastAiAnswer('first');
			setLastAiAnswer('second\n```jinja\n{{ CTX.value }}\n```');
			assert.strictEqual(getLastAiAnswer(), 'second\n```jinja\n{{ CTX.value }}\n```');
		});

		test('retains an explicitly empty final answer instead of falling back to stale content', () => {
			setLastAiAnswer('stale');
			setLastAiAnswer('');
			assert.strictEqual(getLastAiAnswer(), '');
		});
	});

	suite('renderSourcesMarkdown()', () => {
		test('returns no markdown when the backend returned no sources', () => {
			assert.strictEqual(renderSourcesMarkdown([]), '');
		});

		test('renders HTTP sources as links and opaque sources as unlinked labels', () => {
			assert.strictEqual(
				renderSourcesMarkdown([
					{ label: 'Rewst Docs', source: 'https://docs.rewst.help/page', section: 'Jinja' },
					{ label: 'Internal note', source: 'note-1' },
				]),
				'\n\n**Sources**\n- [Rewst Docs](https://docs.rewst.help/page) — Jinja\n- Internal note\n',
			);
		});

		test('recognizes URL schemes case-insensitively', () => {
			assert.match(
				renderSourcesMarkdown([{ label: 'Docs', source: 'HTTPS://example.test/docs' }]),
				/\[Docs\]\(HTTPS:/,
			);
		});

		test('does not turn non-http schemes into clickable links', () => {
			for (const source of [
				'javascript:alert(1)',
				'data:text/html,test',
				'file:///tmp/secret',
				'//example.test',
			]) {
				const rendered = renderSourcesMarkdown([{ label: 'Untrusted', source }]);
				assert.strictEqual(rendered.includes(']('), false, source);
			}
		});

		test('escapes markdown control characters in labels and section names', () => {
			const rendered = renderSourcesMarkdown([
				{
					label: 'Docs [preview](javascript:alert(1))',
					source: 'https://example.test/docs',
					section: '**admin** [link](javascript:alert(2))',
				},
			]);

			// Property, not mechanism: any neutralization (escape, strip, entity-encode)
			// is acceptable so long as the attacker's label/section cannot introduce an
			// active markdown link. Assert no injected link exists and that the
			// human-readable text still survives — do NOT pin backslash-escaping.
			assert.doesNotMatch(rendered, /\[preview\]\(javascript:/);
			assert.doesNotMatch(rendered, /\[link\]\(javascript:/);
			assert.doesNotMatch(rendered, /\]\(javascript:/);
			assert.doesNotMatch(rendered, /\]\(data:/);
			assert.match(rendered, /preview/);
			assert.match(rendered, /admin/);
		});

		test('keeps every source in backend order, including duplicate labels', () => {
			const rendered = renderSourcesMarkdown([
				{ label: 'Same', source: 'https://example.test/first' },
				{ label: 'Same', source: 'https://example.test/second' },
			]);
			assert.ok(rendered.indexOf('/first') < rendered.indexOf('/second'));
			assert.strictEqual(rendered.match(/- \[Same\]/g)?.length, 2);
		});
	});
});
