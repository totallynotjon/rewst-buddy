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
});
