import { context } from '@global';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import CommandInitiater from './CommandInitiater';
import * as Commands from './exportedCommands';
import { createCommand } from './GenericCommand';

const { suite, test, setup, teardown } = Mocha;

type RegisteredCallback = (...args: unknown[]) => Promise<unknown>;

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

suite('Unit: CommandInitiater', () => {
	const restores: Restore[] = [];
	let registrations: Map<string, RegisteredCallback>;
	let registeredDisposables: vscode.Disposable[];

	setup(() => {
		initTestEnvironment();
		registrations = new Map();
		registeredDisposables = [];
		restores.push(
			stub(vscode.commands, 'registerCommand', ((name: string, callback: RegisteredCallback) => {
				assert.strictEqual(registrations.has(name), false, `duplicate registration: ${name}`);
				registrations.set(name, callback);
				const disposable = new vscode.Disposable(() => {});
				registeredDisposables.push(disposable);
				return disposable;
			}) as typeof vscode.commands.registerCommand),
		);
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
	});

	test('registers both normal and prefix aliases for every exported command class', () => {
		CommandInitiater.registerCommands();

		const expectedNames = Object.values(Commands).flatMap(type => {
			const command = createCommand(type);
			return [`rewst-buddy.${command.commandName}`, `rewst-buddy.prefix.${command.commandName}`];
		});
		assert.strictEqual(registrations.size, expectedNames.length);
		assert.deepStrictEqual([...registrations.keys()].sort(), expectedNames.sort());
	});

	test('retains every command registration in extension subscriptions', () => {
		const before = context.subscriptions.length;

		CommandInitiater.registerCommands();

		assert.strictEqual(context.subscriptions.length, before + registeredDisposables.length);
		for (const disposable of registeredDisposables) assert.ok(context.subscriptions.includes(disposable));
	});

	test('normal and prefix aliases each invoke the command with the original URI argument', async () => {
		const clipboardWrites: string[] = [];
		restores.push(
			stub(vscode.env, 'clipboard', {
				readText: async () => '',
				writeText: async (value: string) => {
					clipboardWrites.push(value);
				},
			} as typeof vscode.env.clipboard),
		);
		CommandInitiater.registerCommands();
		const uri = vscode.Uri.file('/workspace/template.jinja');

		await registrations.get('rewst-buddy.CopyPath')!(uri);
		await registrations.get('rewst-buddy.prefix.CopyPath')!(uri);

		assert.deepStrictEqual(clipboardWrites, [uri.fsPath, uri.fsPath]);
	});

	test('preserves tree-item resourceUri arguments through the registration adapter', async () => {
		let copied: string | undefined;
		restores.push(
			stub(vscode.env, 'clipboard', {
				readText: async () => '',
				writeText: async (value: string) => {
					copied = value;
				},
			} as typeof vscode.env.clipboard),
		);
		CommandInitiater.registerCommands();
		const uri = vscode.Uri.file('/workspace/tree-template.jinja');

		await registrations.get('rewst-buddy.CopyPath')!({ resourceUri: uri });

		assert.strictEqual(copied, uri.fsPath);
	});

	test('returns the command result promise and propagates command errors to VS Code', async () => {
		CommandInitiater.registerCommands();
		const callback = registrations.get('rewst-buddy.CopyPath')!;

		await assert.rejects(() => callback({ resourceUri: 'not-a-vscode-uri' }), /Could not parse URI/);
	});
});
