import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { context } from '@global';
import { getMcpToken, _resetMcpTokenForTesting } from '@mcp';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import { RotateMcpToken } from './RotateMcpToken';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

/** Replaces one method on a (real) vscode object and returns a restore handle. */
function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): Restore {
	const original = obj[key];
	Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
	return {
		restore() {
			Object.defineProperty(obj, key, { value: original, configurable: true, writable: true });
		},
	};
}

suite('Unit: RotateMcpToken', () => {
	const restores: Restore[] = [];
	let warningChoice: string | undefined;
	let warningMessage: string | undefined;
	let warningOptions: vscode.MessageOptions | undefined;
	let warningItems: string[] = [];
	let infoMessages: string[] = [];
	let errorMessages: string[] = [];

	setup(async () => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		await _resetMcpTokenForTesting();
		warningChoice = undefined;
		warningMessage = undefined;
		warningOptions = undefined;
		warningItems = [];
		infoMessages = [];
		errorMessages = [];

		restores.push(
			stub(vscode.window, 'showWarningMessage', (async (
				message: string,
				options: vscode.MessageOptions,
				...items: string[]
			) => {
				warningMessage = message;
				warningOptions = options;
				warningItems = items;
				return warningChoice;
			}) as unknown as typeof vscode.window.showWarningMessage),
			stub(vscode.window, 'showInformationMessage', (async (message: string) => {
				infoMessages.push(message);
				return undefined;
			}) as unknown as typeof vscode.window.showInformationMessage),
			stub(vscode.window, 'showErrorMessage', (async (message: string) => {
				errorMessages.push(message);
				return undefined;
			}) as unknown as typeof vscode.window.showErrorMessage),
		);
	});

	teardown(async () => {
		while (restores.length) restores.pop()!.restore();
		await _resetMcpTokenForTesting();
		SessionManager._resetForTesting();
	});

	test('rotating changes the token after confirmation', async () => {
		const before = getMcpToken();
		warningChoice = 'Rotate Token';

		await new RotateMcpToken().execute();

		assert.notStrictEqual(getMcpToken(), before, 'token rotates after confirmation');
		assert.strictEqual(warningOptions?.modal, true, 'confirmation is modal');
		assert.ok(warningMessage?.includes('old token'), 'warns about old-token access loss');
		assert.ok(warningItems.includes('Rotate Token'), 'offers the destructive action');
		assert.ok(
			infoMessages.some(message => message.includes('MCP token rotated')),
			'reports success',
		);
		assert.deepStrictEqual(errorMessages, [], 'does not report an error');
	});

	test('dismissal leaves the token unchanged', async () => {
		const before = getMcpToken();
		warningChoice = undefined;

		await new RotateMcpToken().execute();

		assert.strictEqual(getMcpToken(), before, 'token does not rotate without confirmation');
		assert.deepStrictEqual(infoMessages, [], 'does not report success');
		assert.deepStrictEqual(errorMessages, [], 'does not report an error');
	});

	test('a rotation failure is surfaced as an error notification', async () => {
		warningChoice = 'Rotate Token';
		// rotateMcpToken persists through context.globalState.update, evaluated
		// synchronously; making it throw drives execute() down its catch path.
		restores.push(
			stub(context.globalState, 'update', (() => {
				throw new Error('persist boom');
			}) as unknown as typeof context.globalState.update),
		);

		await new RotateMcpToken().execute();

		assert.deepStrictEqual(infoMessages, [], 'does not report success when rotation fails');
		assert.ok(
			errorMessages.some(message => message.includes('failed to rotate MCP token')),
			'reports the failure as an error notification',
		);
	});
});
