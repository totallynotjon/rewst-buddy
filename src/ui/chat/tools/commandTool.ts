import { extPrefix } from '@global';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import vscode from 'vscode';
import { asStringArg, type ToolRequest, type ToolSpec } from './toolProtocol';

/**
 * run_command lets RoboRewsty execute a shell command on the user's machine
 * and read its output. Unlike the file tools, the model directing the command
 * is remote (Rewst's assistant) and the output is sent back to Rewst — so this
 * is the most sensitive tool by far:
 *
 *   - Off by default (rewst-buddy.ai.enableCommandTool).
 *   - Every command requires explicit user approval in a modal, unless the
 *     user opts out with rewst-buddy.ai.autoApproveCommands.
 *   - Runs in the workspace root, with a timeout and output cap.
 *
 * It is the user's own machine and their own extension, so this is an
 * ordinary local-automation capability — the gating exists because a remote
 * model is the one proposing the commands.
 */

const execAsync = promisify(exec);

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 10_000;
const MAX_BUFFER_BYTES = 1_024 * 1_024;

export const COMMAND_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'run_command',
		args: '{"command": string}',
		description:
			'Run a shell command in the workspace root and return its combined stdout/stderr and exit code. The user must approve each command before it runs, so explain what you intend to run.',
	},
];

const COMMAND_TOOL_NAMES = new Set(COMMAND_TOOL_SPECS.map(spec => spec.name));

export function isCommandTool(name: string): boolean {
	return COMMAND_TOOL_NAMES.has(name);
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface CommandToolDeps {
	isEnabled(): boolean;
	autoApprove(): boolean;
	/** Shows the approval modal; returns true to run. */
	confirm(command: string): Promise<boolean>;
	cwd(): string | undefined;
	run(command: string, cwd: string | undefined): Promise<ExecResult>;
}

export const defaultCommandDeps: CommandToolDeps = {
	isEnabled: () => vscode.workspace.getConfiguration(`${extPrefix}.ai`).get<boolean>('enableCommandTool', false),
	autoApprove: () => vscode.workspace.getConfiguration(`${extPrefix}.ai`).get<boolean>('autoApproveCommands', false),
	confirm: async command => {
		const choice = await vscode.window.showWarningMessage(
			'RoboRewsty wants to run a command on your machine:',
			{ modal: true, detail: command },
			'Run',
		);
		return choice === 'Run';
	},
	cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
	run: async (command, cwd) => {
		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd,
				timeout: COMMAND_TIMEOUT_MS,
				maxBuffer: MAX_BUFFER_BYTES,
				windowsHide: true,
			});
			return { stdout, stderr, code: 0 };
		} catch (error) {
			// exec rejects on non-zero exit; the error carries the captured output.
			const e = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean; message?: string };
			if (e.killed) throw new Error(`Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s.`);
			return {
				stdout: e.stdout ?? '',
				stderr: e.stderr ?? e.message ?? '',
				code: typeof e.code === 'number' ? e.code : 1,
			};
		}
	},
};

function formatResult(result: ExecResult): string {
	const sections: string[] = [`Exit code: ${result.code}`];
	if (result.stdout.trim()) sections.push(`stdout:\n${result.stdout.trim()}`);
	if (result.stderr.trim()) sections.push(`stderr:\n${result.stderr.trim()}`);
	if (!result.stdout.trim() && !result.stderr.trim()) sections.push('(no output)');
	const text = sections.join('\n\n');
	return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + '\n…(output truncated)' : text;
}

export async function runCommandTool(
	request: ToolRequest,
	deps: CommandToolDeps = defaultCommandDeps,
): Promise<string> {
	if (!deps.isEnabled()) {
		throw new Error(
			'The run_command tool is disabled. The user can enable it with the rewst-buddy.ai.enableCommandTool setting.',
		);
	}
	const command = asStringArg(request.args, 'command');
	if (!command) throw new Error('run_command requires a "command" argument.');

	if (!deps.autoApprove() && !(await deps.confirm(command))) {
		throw new Error('The user declined to run this command. Do not retry it; ask what they would prefer.');
	}

	return formatResult(await deps.run(command, deps.cwd()));
}
