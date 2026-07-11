import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { isDescendant } from './isDescendant';

const { suite, test } = Mocha;

suite('Unit: isDescendant()', () => {
	test('should return true for direct child', () => {
		const parent = vscode.Uri.file('/home/user/project');
		const child = vscode.Uri.file('/home/user/project/file.txt');
		assert.strictEqual(isDescendant(parent, child), true);
	});

	test('should return true for nested descendant', () => {
		const parent = vscode.Uri.file('/home/user/project');
		const child = vscode.Uri.file('/home/user/project/src/utils/file.txt');
		assert.strictEqual(isDescendant(parent, child), true);
	});

	test('should return true when comparing same path', () => {
		const parent = vscode.Uri.file('/home/user/project');
		const same = vscode.Uri.file('/home/user/project');
		assert.strictEqual(isDescendant(parent, same), true);
	});

	test('should return false for sibling path', () => {
		const parent = vscode.Uri.file('/home/user/project');
		const sibling = vscode.Uri.file('/home/user/other');
		assert.strictEqual(isDescendant(parent, sibling), false);
	});

	test('should return false for parent path', () => {
		const parent = vscode.Uri.file('/home/user/project/src');
		const ancestor = vscode.Uri.file('/home/user/project');
		assert.strictEqual(isDescendant(parent, ancestor), false);
	});

	test('should return false for paths with common prefix but different directory', () => {
		const parent = vscode.Uri.file('/home/user/project');
		const notChild = vscode.Uri.file('/home/user/project-backup/file.txt');
		assert.strictEqual(isDescendant(parent, notChild), false);
	});

	test('handles a parent URI with a trailing slash', () => {
		const parent = vscode.Uri.parse('file:///home/user/project/');
		const child = vscode.Uri.parse('file:///home/user/project/src/file.txt');
		assert.strictEqual(isDescendant(parent, child), true);
	});

	test('treats every path under the filesystem root as a descendant', () => {
		assert.strictEqual(isDescendant(vscode.Uri.file('/'), vscode.Uri.file('/tmp/file.txt')), true);
	});

	test('ignores query and fragment components when the resource path is the same', () => {
		const parent = vscode.Uri.parse('memfs:/workspace');
		const candidate = vscode.Uri.parse('memfs:/workspace/file?version=2#selection');
		assert.strictEqual(isDescendant(parent, candidate), true);
	});

	test('rejects a candidate containing unresolved parent-directory traversal', () => {
		const parent = vscode.Uri.parse('memfs:/workspace/templates');
		const escaped = vscode.Uri.parse('memfs:/workspace/templates/../secrets/token.txt', true);
		assert.strictEqual(isDescendant(parent, escaped), false);
	});

	test('rejects different schemes and authorities even when paths match', () => {
		const parent = vscode.Uri.parse('vscode-remote://ssh-remote+one/workspace');
		assert.strictEqual(isDescendant(parent, vscode.Uri.parse('file:///workspace/file')), false);
		assert.strictEqual(
			isDescendant(parent, vscode.Uri.parse('vscode-remote://ssh-remote+two/workspace/file')),
			false,
		);
	});

	test('does not confuse an encoded separator with a real child path', () => {
		const parent = vscode.Uri.parse('memfs:/workspace/templates');
		const sibling = vscode.Uri.parse('memfs:/workspace/templates%2Fsecret', true);
		assert.strictEqual(isDescendant(parent, sibling), false);
	});
});
