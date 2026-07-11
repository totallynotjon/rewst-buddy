import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { AskRewstAI } from './AskRewstAI';
import { CopyPath } from './CopyPath';
import { CopyRelativePath } from './CopyRelativePath';
import { FocusSidebar } from './FocusSidebar';
import { OpenInIntegratedTerminal } from './OpenInIntegratedTerminal';
import { OpenToTheSide } from './OpenToTheSide';
import { RevealInExplorer } from './RevealInExplorer';
import { RevealInOS } from './RevealInOS';

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

suite('Unit: basic UI command adapters', () => {
	const restores: Restore[] = [];
	let commandCalls: unknown[][];
	let clipboardWrites: string[];

	setup(() => {
		initTestEnvironment();
		commandCalls = [];
		clipboardWrites = [];
		restores.push(
			stub(vscode.commands, 'executeCommand', (async (...args: unknown[]) => {
				commandCalls.push(args);
				return undefined;
			}) as unknown as typeof vscode.commands.executeCommand),
		);
		restores.push(
			stub(vscode.env, 'clipboard', {
				readText: async () => '',
				writeText: async (value: string) => {
					clipboardWrites.push(value);
				},
			} as typeof vscode.env.clipboard),
		);
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
	});

	test('CopyPath writes the platform filesystem path', async () => {
		const uri = vscode.Uri.file('/workspace/folder/template.jinja');

		await new CopyPath().execute(uri);

		assert.deepStrictEqual(clipboardWrites, [uri.fsPath]);
		assert.deepStrictEqual(commandCalls, []);
	});

	test('CopyPath accepts a tree item resource URI', async () => {
		const uri = vscode.Uri.file('/workspace/tree.jinja');
		await new CopyPath().execute({ resourceUri: uri });
		assert.deepStrictEqual(clipboardWrites, [uri.fsPath]);
	});

	test('CopyPath rejects malformed invocation without modifying the clipboard', async () => {
		await assert.rejects(
			() => new CopyPath().execute({ resourceUri: 'file:///not-an-object-uri' }),
			/Could not parse URI/,
		);
		assert.deepStrictEqual(clipboardWrites, []);
	});

	test('CopyRelativePath copies the workspace-relative representation supplied by VS Code', async () => {
		const uri = vscode.Uri.file('/workspace/folder/template.jinja');
		restores.push(
			stub(vscode.workspace, 'asRelativePath', ((candidate: vscode.Uri) => {
				assert.strictEqual(candidate.toString(), uri.toString());
				return 'folder/template.jinja';
			}) as typeof vscode.workspace.asRelativePath),
		);

		await new CopyRelativePath().execute(uri);

		assert.deepStrictEqual(clipboardWrites, ['folder/template.jinja']);
	});

	test('OpenToTheSide forwards the URI and beside column to vscode.open', async () => {
		const uri = vscode.Uri.file('/workspace/template.jinja');
		await new OpenToTheSide().execute(uri);
		assert.deepStrictEqual(commandCalls, [['vscode.open', uri, vscode.ViewColumn.Beside]]);
	});

	test('OpenInIntegratedTerminal forwards the selected resource', async () => {
		const uri = vscode.Uri.file('/workspace/folder');
		await new OpenInIntegratedTerminal().execute(uri);
		assert.deepStrictEqual(commandCalls, [['openInIntegratedTerminal', uri]]);
	});

	test('RevealInExplorer forwards the selected resource', async () => {
		const uri = vscode.Uri.file('/workspace/template.jinja');
		await new RevealInExplorer().execute(uri);
		assert.deepStrictEqual(commandCalls, [['revealInExplorer', uri]]);
	});

	test('RevealInOS forwards the selected resource', async () => {
		const uri = vscode.Uri.file('/workspace/template.jinja');
		await new RevealInOS().execute(uri);
		assert.deepStrictEqual(commandCalls, [['revealFileInOS', uri]]);
	});

	test('FocusSidebar focuses the contributed session-input view', async () => {
		await new FocusSidebar().execute('ignored argument');
		assert.deepStrictEqual(commandCalls, [['rewst-buddy.sessionInput.focus']]);
	});

	test('AskRewstAI opens the built-in chat view without injecting a participant prompt', async () => {
		await new AskRewstAI().execute();
		assert.deepStrictEqual(commandCalls, [['workbench.action.chat.open']]);
	});

	test('awaits and propagates a delegated VS Code command failure', async () => {
		const expected = new Error('chat command unavailable');
		restores.pop()!.restore();
		restores.push(
			stub(vscode.commands, 'executeCommand', (async () => {
				throw expected;
			}) as unknown as typeof vscode.commands.executeCommand),
		);

		await assert.rejects(
			() => new AskRewstAI().execute(),
			error => error === expected,
		);
	});

	test('awaits and propagates clipboard write failures', async () => {
		const expected = new Error('clipboard unavailable');
		const clipboardRestore = restores.pop()!;
		clipboardRestore.restore();
		restores.push(
			stub(vscode.env, 'clipboard', {
				readText: async () => '',
				writeText: async () => {
					throw expected;
				},
			} as typeof vscode.env.clipboard),
		);

		await assert.rejects(
			() => new CopyPath().execute(vscode.Uri.file('/workspace/file')),
			error => error === expected,
		);
	});
});
