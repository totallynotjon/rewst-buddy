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
});
