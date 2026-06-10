import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import vscode from 'vscode';
import {
	firstReferencedFileUri,
	formatPromptWithReferences,
	MAX_REFERENCE_CHARS,
	MAX_TOTAL_REFERENCE_CHARS,
	prependInstructions,
	resolveReferences,
} from './promptContext';

const { suite, test, setup } = Mocha;

function ref(value: unknown, modelDescription?: string): vscode.ChatPromptReference {
	return { id: 'test-ref', value, modelDescription } as vscode.ChatPromptReference;
}

suite('Unit: promptContext', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('resolveReferences()', () => {
		test('resolves string references with modelDescription label', async () => {
			const resolved = await resolveReferences([ref('pasted text', 'Clipboard')], async () => '');
			assert.deepStrictEqual(resolved, [{ label: 'Clipboard', content: 'pasted text', truncated: false }]);
		});

		test('resolves Uri references via the file reader', async () => {
			const uri = vscode.Uri.file('/tmp/example.jinja');
			const resolved = await resolveReferences([ref(uri)], async u => {
				assert.strictEqual(u.toString(), uri.toString());
				return 'file body';
			});
			assert.strictEqual(resolved.length, 1);
			assert.strictEqual(resolved[0].content, 'file body');
			assert.match(resolved[0].label, /example\.jinja$/);
		});

		test('resolves Location references with line range label', async () => {
			const uri = vscode.Uri.file('/tmp/example.jinja');
			const location = new vscode.Location(uri, new vscode.Range(2, 0, 4, 10));
			const resolved = await resolveReferences([ref(location)], async (_u, range) => {
				assert.ok(range, 'range should be forwarded');
				return 'selected lines';
			});
			assert.strictEqual(resolved.length, 1);
			assert.match(resolved[0].label, /example\.jinja \(lines 3-5\)$/);
		});

		test('skips unknown reference kinds and unreadable files', async () => {
			const uri = vscode.Uri.file('/tmp/missing.bin');
			const resolved = await resolveReferences([ref({ some: 'binary' }), ref(uri)], async () => {
				throw new Error('cannot read');
			});
			assert.deepStrictEqual(resolved, []);
		});

		test('skips empty content', async () => {
			const resolved = await resolveReferences([ref(vscode.Uri.file('/tmp/empty.txt'))], async () => '');
			assert.deepStrictEqual(resolved, []);
		});

		test('truncates per-reference and total budgets', async () => {
			const big = 'x'.repeat(MAX_REFERENCE_CHARS + 1000);
			const refs = [1, 2, 3, 4].map(i => ref(vscode.Uri.file(`/tmp/big${i}.txt`)));
			const resolved = await resolveReferences(refs, async () => big);

			assert.ok(resolved.length < refs.length, 'total budget should drop trailing references');
			assert.ok(resolved.every(r => r.truncated));
			assert.ok(resolved.every(r => r.content.length <= MAX_REFERENCE_CHARS));
			const total = resolved.reduce((sum, r) => sum + r.content.length, 0);
			assert.ok(total <= MAX_TOTAL_REFERENCE_CHARS);
		});
	});

	suite('prependInstructions()', () => {
		test('returns message unchanged for empty or whitespace instructions', () => {
			assert.strictEqual(prependInstructions('question', undefined), 'question');
			assert.strictEqual(prependInstructions('question', ''), 'question');
			assert.strictEqual(prependInstructions('question', '   \n '), 'question');
		});

		test('prepends trimmed instructions with separator', () => {
			const result = prependInstructions('question', '  answer briefly  ');
			assert.strictEqual(result, "User's standing instructions: answer briefly\n\n---\n\nquestion");
		});
	});

	suite('firstReferencedFileUri()', () => {
		test('returns undefined with no file-backed references', () => {
			assert.strictEqual(firstReferencedFileUri([ref('text'), ref({ binary: true })]), undefined);
		});

		test('returns uri from Location and Uri references in order', () => {
			const locUri = vscode.Uri.file('/tmp/a.jinja');
			const fileUri = vscode.Uri.file('/tmp/b.jinja');
			const location = new vscode.Location(locUri, new vscode.Range(0, 0, 1, 0));

			assert.strictEqual(
				firstReferencedFileUri([ref('skip'), ref(location), ref(fileUri)])?.toString(),
				locUri.toString(),
			);
			assert.strictEqual(firstReferencedFileUri([ref(fileUri)])?.toString(), fileUri.toString());
		});
	});

	suite('formatPromptWithReferences()', () => {
		test('returns prompt unchanged with no references', () => {
			assert.strictEqual(formatPromptWithReferences('hello', []), 'hello');
		});

		test('appends fenced context blocks with labels', () => {
			const result = formatPromptWithReferences('explain this', [
				{ label: 'a.jinja (lines 1-3)', content: '{{ foo }}', truncated: false },
				{ label: 'b.jinja', content: 'body', truncated: true },
			]);
			assert.match(result, /^explain this\n\n/);
			assert.match(result, /### a\.jinja \(lines 1-3\)\n```\n\{\{ foo \}\}\n```/);
			assert.match(result, /### b\.jinja \(truncated\)\n```\nbody\n```/);
		});

		test('uses a fence longer than any backtick run in the content', () => {
			const content = 'docs:\n```\nfenced\n```\nand ````raw````';
			const result = formatPromptWithReferences('q', [{ label: 'c.md', content, truncated: false }]);
			const fence = '`'.repeat(5);
			assert.ok(result.includes(`### c.md\n${fence}\ndocs:`), 'opening fence should be 5 backticks');
			assert.ok(result.endsWith(`\n${fence}`), 'closing fence should be 5 backticks');
		});
	});
});
