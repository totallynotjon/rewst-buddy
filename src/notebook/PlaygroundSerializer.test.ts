import * as assert from 'assert';
import * as Mocha from 'mocha';
import { PlaygroundSerializer } from './PlaygroundSerializer';
import vscode from 'vscode';

const { suite, test } = Mocha;

suite('Unit: PlaygroundSerializer', () => {
	const serializer = new PlaygroundSerializer();

	test('should round-trip serialize and deserialize', () => {
		const cells = [
			new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, '# Test', 'markdown'),
			new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '{ user { id } }', 'graphql'),
			new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '{ "limit": 10 }', 'json'),
		];

		const original = new vscode.NotebookData(cells);
		const bytes = serializer.serializeNotebook(original);
		const restored = serializer.deserializeNotebook(bytes);

		assert.strictEqual(restored.cells.length, 3);
		assert.strictEqual(restored.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(restored.cells[0].value, '# Test');
		assert.strictEqual(restored.cells[0].languageId, 'markdown');
		assert.strictEqual(restored.cells[1].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(restored.cells[1].value, '{ user { id } }');
		assert.strictEqual(restored.cells[1].languageId, 'graphql');
		assert.strictEqual(restored.cells[2].value, '{ "limit": 10 }');
		assert.strictEqual(restored.cells[2].languageId, 'json');
	});

	test('should handle malformed JSON by returning empty query cell', () => {
		const bytes = new TextEncoder().encode('not valid json {{{');
		const result = serializer.deserializeNotebook(bytes);

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[0].value, '');
		assert.strictEqual(result.cells[0].languageId, 'graphql');
	});

	test('should handle empty cells array by returning default cell', () => {
		const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, cells: [] }));
		const result = serializer.deserializeNotebook(bytes);

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].languageId, 'graphql');
	});

	test('should handle empty content', () => {
		const bytes = new Uint8Array(0);
		const result = serializer.deserializeNotebook(bytes);

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].languageId, 'graphql');
	});
});
