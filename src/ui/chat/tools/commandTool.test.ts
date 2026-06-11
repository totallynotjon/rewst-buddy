import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { isCommandTool, runCommandTool, type CommandToolDeps, type ExecResult } from './commandTool';

const { suite, test, setup } = Mocha;

function deps(over: Partial<CommandToolDeps> = {}): CommandToolDeps {
	return {
		isEnabled: () => true,
		autoApprove: () => false,
		confirm: async () => true,
		cwd: () => '/ws',
		run: async () => ({ stdout: '', stderr: '', code: 0 }),
		...over,
	};
}

suite('Unit: commandTool', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('isCommandTool recognizes run_command', () => {
		assert.ok(isCommandTool('run_command'));
		assert.ok(!isCommandTool('read_file'));
	});

	test('fails when the tool is disabled', async () => {
		await assert.rejects(
			runCommandTool({ tool: 'run_command', args: { command: 'ls' } }, deps({ isEnabled: () => false })),
			/enableCommandTool/,
		);
	});

	test('requires a command argument', async () => {
		await assert.rejects(runCommandTool({ tool: 'run_command', args: {} }, deps()), /requires a "command"/);
	});

	test('asks for confirmation and runs the approved command in the cwd', async () => {
		const calls: { command: string; cwd?: string }[] = [];
		let confirmed = '';
		const result = await runCommandTool(
			{ tool: 'run_command', args: { command: 'lsof -i' } },
			deps({
				confirm: async command => {
					confirmed = command;
					return true;
				},
				run: async (command, cwd): Promise<ExecResult> => {
					calls.push({ command, cwd });
					return { stdout: 'COMMAND  PID', stderr: '', code: 0 };
				},
			}),
		);
		assert.strictEqual(confirmed, 'lsof -i');
		assert.deepStrictEqual(calls, [{ command: 'lsof -i', cwd: '/ws' }]);
		assert.match(result, /Exit code: 0/);
		assert.match(result, /stdout:\nCOMMAND {2}PID/);
	});

	test('does not run when the user declines', async () => {
		let ran = false;
		await assert.rejects(
			runCommandTool(
				{ tool: 'run_command', args: { command: 'rm -rf /' } },
				deps({
					confirm: async () => false,
					run: async () => {
						ran = true;
						return { stdout: '', stderr: '', code: 0 };
					},
				}),
			),
			/declined to run this command/,
		);
		assert.strictEqual(ran, false);
	});

	test('skips the prompt when auto-approve is on', async () => {
		let confirmCalls = 0;
		const result = await runCommandTool(
			{ tool: 'run_command', args: { command: 'echo hi' } },
			deps({
				autoApprove: () => true,
				confirm: async () => {
					confirmCalls++;
					return true;
				},
				run: async () => ({ stdout: 'hi', stderr: '', code: 0 }),
			}),
		);
		assert.strictEqual(confirmCalls, 0);
		assert.match(result, /hi/);
	});

	test('reports non-zero exit codes and stderr', async () => {
		const result = await runCommandTool(
			{ tool: 'run_command', args: { command: 'false' } },
			deps({ run: async () => ({ stdout: '', stderr: 'boom', code: 1 }) }),
		);
		assert.match(result, /Exit code: 1/);
		assert.match(result, /stderr:\nboom/);
	});
});
