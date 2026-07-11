import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { ensureSavedDocument, getDocumentFromArgs } from './ensureSavedDocument';
import { parseArgsUri } from './parseArgsUri';
import { uriExists } from './uriExists';
import { writeTextFile } from './writeTextFile';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

function stub<T extends object, K extends keyof T>(object: T, key: K, value: T[K]): Restore {
	const original = object[key];
	Object.defineProperty(object, key, { configurable: true, writable: true, value });
	return {
		restore() {
			Object.defineProperty(object, key, { configurable: true, writable: true, value: original });
		},
	};
}

suite('Unit: command and filesystem boundary utilities', () => {
	let tmpDir: string;
	const restores: Restore[] = [];

	setup(() => {
		initTestEnvironment();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-boundary-utils-'));
	});

	teardown(async () => {
		while (restores.length) restores.pop()!.restore();
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	suite('parseArgsUri()', () => {
		test('accepts a direct URI command argument', () => {
			const uri = vscode.Uri.file(path.join(tmpDir, 'direct.txt'));
			assert.strictEqual(parseArgsUri(uri).toString(), uri.toString());
		});

		test('unwraps the nested arrays produced by command registration adapters', () => {
			const uri = vscode.Uri.file(path.join(tmpDir, 'nested.txt'));
			assert.strictEqual(parseArgsUri([[[uri]]]).toString(), uri.toString());
		});

		test('accepts explorer and tree items carrying resourceUri', () => {
			const uri = vscode.Uri.file(path.join(tmpDir, 'tree.txt'));
			assert.strictEqual(parseArgsUri({ resourceUri: uri }).toString(), uri.toString());
			assert.strictEqual(parseArgsUri([[{ resourceUri: uri }]]).toString(), uri.toString());
		});

		test('rejects URI-shaped strings and objects that are not VS Code URIs', () => {
			assert.throws(() => parseArgsUri('file:///tmp/not-a-uri-object'), /Could not parse URI/);
			assert.throws(() => parseArgsUri({ resourceUri: 'file:///tmp/not-a-uri-object' }), /Could not parse URI/);
		});

		test('rejects empty, nullish, and unrelated command arguments', () => {
			for (const args of [[], [null], [undefined], [{ id: 'node' }]]) {
				assert.throws(() => parseArgsUri(args), /Could not parse URI/);
			}
		});

		test('caps pathological nesting instead of walking an unbounded argument graph', () => {
			const uri = vscode.Uri.file(path.join(tmpDir, 'too-deep.txt'));
			let nested: unknown = uri;
			for (let i = 0; i < 20; i++) nested = [nested];
			assert.throws(() => parseArgsUri(nested), /Could not parse URI/);
		});
	});

	suite('document selection and save handling', () => {
		test('opens the document identified by a command URI before consulting the active editor', async () => {
			const file = path.join(tmpDir, 'argument.txt');
			fs.writeFileSync(file, 'from argument');

			const document = await getDocumentFromArgs([vscode.Uri.file(file)]);

			assert.strictEqual(document.uri.fsPath, file);
			assert.strictEqual(document.getText(), 'from argument');
		});

		test('falls back to the active editor when command arguments do not contain a URI', async () => {
			const active = await vscode.workspace.openTextDocument({
				content: 'active editor body',
				language: 'jinja',
			});
			await vscode.window.showTextDocument(active);

			const document = await getDocumentFromArgs([]);

			assert.strictEqual(document, active);
		});

		test('returns an already-saved document without invoking Save As', async () => {
			const file = path.join(tmpDir, 'saved.txt');
			fs.writeFileSync(file, 'saved');
			let saveAsCalls = 0;
			restores.push(
				stub(vscode.workspace, 'saveAs', (async () => {
					saveAsCalls++;
					return undefined;
				}) as typeof vscode.workspace.saveAs),
			);

			const document = await ensureSavedDocument([vscode.Uri.file(file)]);

			assert.strictEqual(document.uri.fsPath, file);
			assert.strictEqual(saveAsCalls, 0);
		});

		test('rejects cleanly when the user cancels Save As for an untitled document', async () => {
			const untitled = await vscode.workspace.openTextDocument({ content: 'draft' });
			restores.push(stub(vscode.workspace, 'saveAs', (async () => undefined) as typeof vscode.workspace.saveAs));

			await assert.rejects(() => ensureSavedDocument([untitled.uri]), /Must save document to disk/);
		});

		test('reopens and returns the URI selected by Save As', async () => {
			const untitled = await vscode.workspace.openTextDocument({ content: 'draft' });
			const savedPath = path.join(tmpDir, 'selected.jinja');
			fs.writeFileSync(savedPath, 'persisted by save provider');
			const savedUri = vscode.Uri.file(savedPath);
			restores.push(stub(vscode.workspace, 'saveAs', (async () => savedUri) as typeof vscode.workspace.saveAs));

			const document = await ensureSavedDocument([untitled.uri]);

			assert.strictEqual(document.uri.fsPath, savedPath);
			assert.strictEqual(document.getText(), 'persisted by save provider');
		});
	});

	suite('uriExists() and writeTextFile()', () => {
		test('distinguishes existing files, directories, and missing paths', async () => {
			const file = vscode.Uri.file(path.join(tmpDir, 'exists.txt'));
			fs.writeFileSync(file.fsPath, 'body');

			assert.strictEqual(await uriExists(file), true);
			assert.strictEqual(await uriExists(vscode.Uri.file(tmpDir)), true);
			assert.strictEqual(await uriExists(vscode.Uri.file(path.join(tmpDir, 'missing.txt'))), false);
		});

		test('writes UTF-8 text exactly, including non-ASCII and null bytes', async () => {
			const uri = vscode.Uri.file(path.join(tmpDir, 'unicode.txt'));
			const content = 'plain\naccent: café\nemoji: 😀\nnull:\0end';

			await writeTextFile(uri, content);

			assert.deepStrictEqual(fs.readFileSync(uri.fsPath), Buffer.from(content, 'utf8'));
		});

		test('overwrites an existing file and supports an empty body', async () => {
			const uri = vscode.Uri.file(path.join(tmpDir, 'overwrite.txt'));
			fs.writeFileSync(uri.fsPath, 'old body');

			await writeTextFile(uri, 'new body');
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), 'new body');

			await writeTextFile(uri, '');
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), '');
		});

		test('surfaces filesystem write failures instead of reporting false success', async () => {
			const uri = vscode.Uri.file(path.join(tmpDir, 'missing-parent', 'file.txt'));
			await assert.rejects(() => writeTextFile(uri, 'body'));
			assert.strictEqual(await uriExists(uri), false);
		});
	});
});
