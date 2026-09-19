import type { Restore } from '@test';
import { createMockContext, initTestEnvironment, stub } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { WorkflowExportViewProvider } from '@ui';
import { activate, registerWorkflowExportViewProvider } from './extension';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: extension activation workflow exporter registration', () => {
	const restores: Restore[] = [];

	setup(() => {
		initTestEnvironment();
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
	});

	test('registers the persistent view and owns both provider and registration disposal', () => {
		const registrations: {
			viewType: string;
			provider: vscode.WebviewViewProvider;
			options?: { webviewOptions?: { retainContextWhenHidden?: boolean } };
		}[] = [];
		let registrationDisposals = 0;
		const registration = new vscode.Disposable(() => registrationDisposals++);
		restores.push(
			stub(vscode.window, 'registerWebviewViewProvider', ((viewType, provider, options) => {
				registrations.push({ viewType, provider, options });
				return registration;
			}) as typeof vscode.window.registerWebviewViewProvider),
		);
		const context = createMockContext();

		const provider = registerWorkflowExportViewProvider(context);

		assert.strictEqual(WorkflowExportViewProvider.viewType, 'rewst-buddy.workflowExporter');
		assert.deepStrictEqual(registrations, [
			{
				viewType: WorkflowExportViewProvider.viewType,
				provider,
				options: { webviewOptions: { retainContextWhenHidden: true } },
			},
		]);
		assert.deepStrictEqual(context.subscriptions, [provider, registration]);

		let providerDisposals = 0;
		restores.push(stub(provider, 'dispose', () => providerDisposals++));
		for (const disposable of context.subscriptions) disposable.dispose();
		assert.strictEqual(providerDisposals, 1);
		assert.strictEqual(registrationDisposals, 1);
	});

	test('activate registers the workflow exporter through the extension context with retained webview state', async () => {
		const registrations: {
			viewType: string;
			provider: vscode.WebviewViewProvider;
			options?: { webviewOptions?: { retainContextWhenHidden?: boolean } };
			registration: vscode.Disposable;
		}[] = [];
		restores.push(
			stub(vscode.window, 'registerWebviewViewProvider', ((viewType, provider, options) => {
				const registration = new vscode.Disposable(() => {});
				registrations.push({ viewType, provider, options, registration });
				return registration;
			}) as typeof vscode.window.registerWebviewViewProvider),
		);
		const context = createMockContext();
		let receivedContext: Pick<vscode.ExtensionContext, 'extensionUri' | 'subscriptions'> | undefined;
		const registrationObserved = new Error('workflow export registration observed');

		await assert.rejects(
			() =>
				activate(context, {
					initializeBackend: () => new vscode.Disposable(() => {}),
					subscribeBackend: () => new vscode.Disposable(() => {}),
					registerWorkflowExportViewProvider: activationContext => {
						receivedContext = activationContext;
						registerWorkflowExportViewProvider(activationContext);
						throw registrationObserved;
					},
				}),
			error => error === registrationObserved,
		);

		const workflowRegistration = registrations.find(
			registration => registration.viewType === WorkflowExportViewProvider.viewType,
		);
		assert.ok(workflowRegistration);
		assert.ok(workflowRegistration.provider instanceof WorkflowExportViewProvider);
		assert.deepStrictEqual(workflowRegistration.options, {
			webviewOptions: { retainContextWhenHidden: true },
		});
		assert.strictEqual(receivedContext, context);
		assert.ok(context.subscriptions.includes(workflowRegistration.provider as vscode.Disposable));
		assert.ok(context.subscriptions.includes(workflowRegistration.registration));
	});
});
