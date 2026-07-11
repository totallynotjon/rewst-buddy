import * as assert from 'assert';
import * as Mocha from 'mocha';
import { extractCodeBlocks } from './codeBlocks';

const { suite, test } = Mocha;

suite('Unit: extractCodeBlocks', () => {
	test('returns empty for plain text', () => {
		assert.deepStrictEqual(extractCodeBlocks('No code here, just prose.'), []);
	});

	test('extracts a single fenced block with language', () => {
		const md = 'Try this:\n\n```jinja\n{{ foo | tojson }}\n```\n\nDone.';
		assert.deepStrictEqual(extractCodeBlocks(md), [{ language: 'jinja', content: '{{ foo | tojson }}' }]);
	});

	test('extracts multiple blocks and preserves order', () => {
		const md = '```\nfirst\n```\ntext\n```yaml\nsecond: true\n```';
		const blocks = extractCodeBlocks(md);
		assert.strictEqual(blocks.length, 2);
		assert.deepStrictEqual(blocks[0], { language: undefined, content: 'first' });
		assert.deepStrictEqual(blocks[1], { language: 'yaml', content: 'second: true' });
	});

	test('keeps internal newlines and trims only the trailing fence newline', () => {
		const md = '```\nline1\n\nline3\n```';
		assert.deepStrictEqual(extractCodeBlocks(md), [{ language: undefined, content: 'line1\n\nline3' }]);
	});

	test('skips empty/whitespace-only blocks', () => {
		const md = '```\n\n```\n```\n   \n```';
		assert.deepStrictEqual(extractCodeBlocks(md), []);
	});

	test('ignores unterminated fences', () => {
		const md = '```jinja\n{{ unclosed }}';
		assert.deepStrictEqual(extractCodeBlocks(md), []);
	});

	test('does not treat inline code as a block', () => {
		assert.deepStrictEqual(extractCodeBlocks('Use `template(id)` inline.'), []);
	});

	test('preserves inner triple backticks inside a four-backtick fence', () => {
		const md = '````md\nUse a fence:\n```\ncode\n```\nDone.\n````';
		assert.deepStrictEqual(extractCodeBlocks(md), [
			{ language: 'md', content: 'Use a fence:\n```\ncode\n```\nDone.' },
		]);
	});

	test('accepts a closing fence longer than the opening fence', () => {
		const md = '```\ncontent\n`````';
		assert.deepStrictEqual(extractCodeBlocks(md), [{ language: undefined, content: 'content' }]);
	});

	test('requires fences at line start', () => {
		const md = 'inline ```js\nnot a block\n```';
		assert.deepStrictEqual(extractCodeBlocks(md), []);
	});

	test('extracts blocks from CRLF-formatted backend responses without retaining carriage returns', () => {
		const md = 'Try this:\r\n\r\n```jinja\r\nline one\r\nline two\r\n```\r\n';
		assert.deepStrictEqual(extractCodeBlocks(md), [{ language: 'jinja', content: 'line one\r\nline two' }]);
	});

	test('supports CommonMark tilde fences', () => {
		const md = '~~~yaml\nname: example\n~~~';
		assert.deepStrictEqual(extractCodeBlocks(md), [{ language: 'yaml', content: 'name: example' }]);
	});

	test('accepts up to three leading spaces on opening and closing fences', () => {
		for (const spaces of [' ', '  ', '   ']) {
			const md = `${spaces}\`\`\`jinja\n{{ value }}\n${spaces}\`\`\``;
			assert.deepStrictEqual(extractCodeBlocks(md), [{ language: 'jinja', content: '{{ value }}' }]);
		}
	});

	test('rejects a four-space-indented fence because it is an indented code block', () => {
		assert.deepStrictEqual(extractCodeBlocks('    ```jinja\ncontent\n    ```'), []);
	});

	test('does not let a shorter closing fence terminate a longer opening fence', () => {
		const md = '````jinja\nfirst\n```\nstill inside\n````';
		assert.deepStrictEqual(extractCodeBlocks(md), [{ language: 'jinja', content: 'first\n```\nstill inside' }]);
	});

	test('preserves code that begins or ends with spaces while dropping only the fence newline', () => {
		const md = '```text\n  leading\ntrailing  \n```';
		assert.deepStrictEqual(extractCodeBlocks(md), [{ language: 'text', content: '  leading\ntrailing  ' }]);
	});
});
