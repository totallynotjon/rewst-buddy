import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { makeUniqueUri } from './makeUniqueUri';

const { suite, test, setup, teardown } = Mocha;

// Spec: template-linking "Local filenames are safe and unique". makeUniqueUri
// is the mechanism folder fetch uses to turn remote template names into local
// filenames. vscode.workspace.fs in this test host is real (not mocked), so
// existence checks run against a throwaway temp directory on disk, mirroring
// the SyncManager.fetchFolder suite.
suite('Unit: makeUniqueUri', () => {
	let tmpDir: string;
	let folderUri: vscode.Uri;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-makeUniqueUri-'));
		folderUri = vscode.Uri.file(tmpDir);
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('a safe, non-colliding name passes through unchanged', async () => {
		const uri = await makeUniqueUri(folderUri, 'report.txt');
		assert.strictEqual(path.basename(uri.fsPath), 'report.txt');
	});

	test('path-unsafe characters and spaces are sanitized to underscores', async () => {
		const unsafe = await makeUniqueUri(folderUri, 'a/b:c*d?.txt');
		assert.strictEqual(path.basename(unsafe.fsPath), 'a_b_c_d_.txt');

		const spaced = await makeUniqueUri(folderUri, 'my template name.txt');
		assert.strictEqual(path.basename(spaced.fsPath), 'my_template_name.txt');
	});

	test('a name colliding with existing files gets a (1)/(2) suffix before the extension', async () => {
		fs.writeFileSync(path.join(tmpDir, 'report.txt'), 'existing');
		const first = await makeUniqueUri(folderUri, 'report.txt');
		assert.strictEqual(path.basename(first.fsPath), 'report(1).txt');

		fs.writeFileSync(path.join(tmpDir, 'report(1).txt'), 'existing too');
		const second = await makeUniqueUri(folderUri, 'report.txt');
		assert.strictEqual(path.basename(second.fsPath), 'report(2).txt');
	});

	test('reserved URIs from a batch count as collisions before any file exists', async () => {
		const reserved = new Set<string>();
		const first = await makeUniqueUri(folderUri, 'Dup', reserved);
		reserved.add(first.toString());
		const second = await makeUniqueUri(folderUri, 'Dup', reserved);

		assert.strictEqual(path.basename(first.fsPath), 'Dup');
		assert.strictEqual(path.basename(second.fsPath), 'Dup(1)');
	});

	test('blank and whitespace-only remote names still produce a file inside the target folder', async () => {
		for (const name of ['', '   ', '\t\n']) {
			const uri = await makeUniqueUri(folderUri, name);
			assert.notStrictEqual(uri.toString(), folderUri.toString(), JSON.stringify(name));
			assert.strictEqual(path.dirname(uri.fsPath), tmpDir, JSON.stringify(name));
			assert.ok(path.basename(uri.fsPath).length > 0, JSON.stringify(name));
		}
	});

	test('dot-segment names cannot resolve to the folder itself or its parent', async () => {
		for (const name of ['.', '..']) {
			const uri = await makeUniqueUri(folderUri, name);
			assert.strictEqual(path.dirname(uri.fsPath), tmpDir, name);
			assert.notStrictEqual(uri.toString(), folderUri.toString(), name);
			assert.notStrictEqual(uri.fsPath, path.dirname(tmpDir), name);
		}
	});

	test('sanitizes ASCII control characters that are unsafe or invisible in explorer views', async () => {
		const uri = await makeUniqueUri(folderUri, 'line\nbreak\ttemplate\0.jinja');
		for (const char of path.basename(uri.fsPath)) {
			const code = char.charCodeAt(0);
			assert.ok(code > 31 && code !== 127, `unsafe control code ${code}`);
		}
	});

	test('avoids Windows reserved device basenames for cross-platform workspaces', async () => {
		for (const name of ['CON', 'con.txt', 'NUL.jinja', 'COM1', 'LPT9.yaml']) {
			const uri = await makeUniqueUri(folderUri, name);
			assert.doesNotMatch(path.basename(uri.fsPath), /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i, name);
		}
	});

	test('removes trailing spaces and periods that Windows silently rewrites', async () => {
		for (const name of ['template. ', 'template...', 'name   ']) {
			const uri = await makeUniqueUri(folderUri, name);
			assert.doesNotMatch(path.basename(uri.fsPath), /[ .]$/, JSON.stringify(name));
		}
	});

	test('bounds very long remote names to a filesystem-safe component length', async () => {
		const uri = await makeUniqueUri(folderUri, `${'a'.repeat(400)}.jinja`);
		assert.ok(Buffer.byteLength(path.basename(uri.fsPath), 'utf8') <= 255);
		assert.match(path.basename(uri.fsPath), /\.jinja$/);
	});

	test('keeps hidden-file names and multi-part extensions intact', async () => {
		assert.strictEqual(path.basename((await makeUniqueUri(folderUri, '.env')).fsPath), '.env');
		assert.strictEqual(
			path.basename((await makeUniqueUri(folderUri, 'template.test.jinja')).fsPath),
			'template.test.jinja',
		);
	});
});
