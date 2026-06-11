import * as assert from 'assert';
import * as Mocha from 'mocha';
import { diffStats, renderUnifiedDiff } from './diffRender';

const { suite, test } = Mocha;

suite('Unit: diffRender', () => {
	suite('renderUnifiedDiff()', () => {
		test('returns empty for identical content', () => {
			assert.strictEqual(renderUnifiedDiff('same\ntext', 'same\ntext'), '');
		});

		test('shows a replaced line with surrounding context', () => {
			const before = 'one\ntwo\nthree\nfour\nfive';
			const after = 'one\ntwo\nTHREE\nfour\nfive';
			assert.strictEqual(
				renderUnifiedDiff(before, after),
				'@@ -1,5 +1,5 @@\n one\n two\n-three\n+THREE\n four\n five',
			);
		});

		test('shows pure insertions and deletions', () => {
			assert.strictEqual(renderUnifiedDiff('a\nc', 'a\nb\nc'), '@@ -1,2 +1,3 @@\n a\n+b\n c');
			assert.strictEqual(renderUnifiedDiff('a\nb\nc', 'a\nc'), '@@ -1,3 +1,2 @@\n a\n-b\n c');
		});

		test('renders created files as all additions', () => {
			assert.strictEqual(renderUnifiedDiff('', 'line1\nline2'), '@@ -1,0 +1,2 @@\n+line1\n+line2');
		});

		test('caps long diffs with a trailing note', () => {
			const after = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
			const diff = renderUnifiedDiff('', after, { maxLines: 10 });
			const lines = diff.split('\n');
			assert.strictEqual(lines.length, 12); // header + 10 + note
			assert.match(lines[lines.length - 1], /\+90 more lines/);
		});
	});

	suite('diffStats()', () => {
		test('counts added and removed lines', () => {
			assert.strictEqual(diffStats('a\nb\nc', 'a\nX\nY\nc'), '+2 −1');
			assert.strictEqual(diffStats('', 'a\nb'), '+2 −0');
			assert.strictEqual(diffStats('a\nb', ''), '+0 −2');
		});
	});
});
