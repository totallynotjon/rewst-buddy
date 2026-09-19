import type { Restore } from '@test';
import { initTestEnvironment, stub } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { OpenWorkflowExporter } from './OpenWorkflowExporter';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: OpenWorkflowExporter', () => {
	const restores: Restore[] = [];
	let commandCalls: string[];

	setup(() => {
		initTestEnvironment();
		commandCalls = [];
		pushExecuteStub(async command => {
			commandCalls.push(command);
		});
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
	});

	function pushExecuteStub(impl: (command: string) => Promise<void>): void {
		restores.push(
			stub(vscode.commands, 'executeCommand', impl as unknown as typeof vscode.commands.executeCommand),
		);
	}

	test('opens the Rewst Buddy sidebar before focusing the workflow exporter', async () => {
		await new OpenWorkflowExporter().execute();

		assert.deepStrictEqual(commandCalls, [
			'workbench.view.extension.rewst-buddy-sidebar',
			'rewst-buddy.workflowExporter.focus',
		]);
	});

	test('propagates an open-sidebar failure without attempting to focus the view', async () => {
		const expected = new Error('sidebar unavailable');
		restores.pop()!();
		pushExecuteStub(async command => {
			commandCalls.push(command);
			throw expected;
		});

		await assert.rejects(
			() => new OpenWorkflowExporter().execute(),
			error => error === expected,
		);
		assert.deepStrictEqual(commandCalls, ['workbench.view.extension.rewst-buddy-sidebar']);
	});

	test('propagates a focus failure after opening the sidebar', async () => {
		const expected = new Error('view unavailable');
		restores.pop()!();
		pushExecuteStub(async command => {
			commandCalls.push(command);
			if (command === 'rewst-buddy.workflowExporter.focus') throw expected;
		});

		await assert.rejects(
			() => new OpenWorkflowExporter().execute(),
			error => error === expected,
		);
		assert.deepStrictEqual(commandCalls, [
			'workbench.view.extension.rewst-buddy-sidebar',
			'rewst-buddy.workflowExporter.focus',
		]);
	});
});
