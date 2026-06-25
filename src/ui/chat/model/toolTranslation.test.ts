import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import {
	buildInstructionsForChatTools,
	chatToolSpecs,
	collectToolCalls,
	extractTrailingToolResults,
	formatInProcessToolResults,
	partitionToolRequests,
	rejectedToolsNote,
	translateToolRequests,
} from './toolTranslation';

const { suite, test } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

function chatTool(name: string, description = `${name} tool`): vscode.LanguageModelChatTool {
	return { name, description, inputSchema: { type: 'object' } };
}

function fence(request: object): string {
	return '```vscode-tool\n' + JSON.stringify(request) + '\n```';
}

suite('Unit: toolTranslation', () => {
	suite('buildInstructionsForChatTools()', () => {
		test('advertises built-in tools passed by VS Code without Rewst-only examples', () => {
			const instructions = buildInstructionsForChatTools([chatTool('read_file', 'read a file')]);
			assert.ok(instructions.includes('read_file'));
			assert.ok(instructions.includes('read a file'));
			assert.ok(!instructions.includes('list_template_links'));
			assert.ok(!instructions.includes('buddy_graphql'));
		});

		test('advertises unknown tools with their schema', () => {
			const instructions = buildInstructionsForChatTools([chatTool('other_tool', 'does things')]);
			assert.ok(instructions.includes('other_tool'));
			assert.ok(instructions.includes('does things'));
		});
	});

	suite('chatToolSpecs()', () => {
		test('maps VS Code tools into tool specs with a JSON arg signature', () => {
			const [spec] = chatToolSpecs([chatTool('read_file', 'read a file')]);
			assert.strictEqual(spec.name, 'read_file');
			assert.strictEqual(spec.description, 'read a file');
			assert.strictEqual(spec.args, JSON.stringify({ type: 'object' }));
		});

		test('falls back to an empty object signature when a tool has no schema', () => {
			const [spec] = chatToolSpecs([{ name: 't', description: 'd' } as vscode.LanguageModelChatTool]);
			assert.strictEqual(spec.args, '{}');
		});
	});

	suite('partitionToolRequests()', () => {
		test('routes built-in names to VS Code calls and buddy names to in-process requests', () => {
			const content = `${fence({ tool: 'read_file', args: { path: 'a.txt' } })}\n${fence({
				tool: 'buddy_workflow_get',
				args: { workflowId: 'w1' },
			})}`;
			const { vscodeCalls, buddyRequests, rejectedNames } = partitionToolRequests(
				content,
				new Set(['read_file']),
				new Set(['buddy_workflow_get']),
			);
			assert.strictEqual(vscodeCalls.length, 1);
			assert.strictEqual(vscodeCalls[0].name, 'read_file');
			assert.deepStrictEqual(vscodeCalls[0].input, { path: 'a.txt' });
			assert.strictEqual(buddyRequests.length, 1);
			assert.strictEqual(buddyRequests[0].tool, 'buddy_workflow_get');
			assert.deepStrictEqual(buddyRequests[0].args, { workflowId: 'w1' });
			assert.deepStrictEqual(rejectedNames, []);
		});

		test('reports names in neither set as rejected', () => {
			const content = fence({ tool: 'run_command', args: { command: 'ls' } });
			const { vscodeCalls, buddyRequests, rejectedNames } = partitionToolRequests(
				content,
				new Set(['read_file']),
				new Set(['buddy_workflow_get']),
			);
			assert.strictEqual(vscodeCalls.length, 0);
			assert.strictEqual(buddyRequests.length, 0);
			assert.deepStrictEqual(rejectedNames, ['run_command']);
		});

		test('a buddy name takes precedence even when it is also a VS Code tool', () => {
			// When VS Code passed the tool too (under the cap), the buddy in-process
			// path owns it so it never depends on the capped options.tools list.
			const content = fence({ tool: 'buddy_render_jinja', args: {} });
			const { vscodeCalls, buddyRequests } = partitionToolRequests(
				content,
				new Set(['buddy_render_jinja']),
				new Set(['buddy_render_jinja']),
			);
			assert.strictEqual(vscodeCalls.length, 0);
			assert.strictEqual(buddyRequests.length, 1);
		});
	});

	suite('formatInProcessToolResults()', () => {
		test('renders each result under a labeled fenced section the backend can read', () => {
			const message = formatInProcessToolResults([
				{ tool: 'buddy_workflow_get', argsLabel: '{"workflowId":"w1"}', ok: true, output: 'name: Deploy' },
			]);
			assert.ok(message.startsWith('Tool results:'));
			assert.ok(message.includes('buddy_workflow_get'));
			assert.ok(message.includes('{"workflowId":"w1"}'));
			assert.ok(message.includes('name: Deploy'));
			assert.ok(message.includes('give your final answer'));
		});

		test('marks a failed result so the model does not treat the error text as data', () => {
			const message = formatInProcessToolResults([
				{ tool: 'buddy_workflow_get', argsLabel: '', ok: false, output: 'org_required' },
			]);
			assert.ok(/error/i.test(message));
			assert.ok(message.includes('org_required'));
		});
	});

	suite('translateToolRequests()', () => {
		test('emits tool-call parts for permitted requests', () => {
			const content = `Checking.\n${fence({ tool: 'read_file', args: { path: 'a.txt' } })}`;
			const { calls, rejectedNames } = translateToolRequests(content, new Set(['read_file']));
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0].name, 'read_file');
			assert.deepStrictEqual(calls[0].input, { path: 'a.txt' });
			assert.ok(calls[0].callId.length > 0);
			assert.deepStrictEqual(rejectedNames, []);
		});

		test('never emits a call outside the permitted set', () => {
			const content = fence({ tool: 'run_command', args: { command: 'rm -rf /' } });
			const { calls, rejectedNames } = translateToolRequests(content, new Set(['read_file']));
			assert.strictEqual(calls.length, 0);
			assert.deepStrictEqual(rejectedNames, ['run_command']);
		});

		test('generates unique call ids', () => {
			const content = `${fence({ tool: 'read_file', args: { path: 'a' } })}\n${fence({ tool: 'read_file', args: { path: 'b' } })}`;
			const { calls } = translateToolRequests(content, new Set(['read_file']));
			assert.strictEqual(calls.length, 2);
			assert.notStrictEqual(calls[0].callId, calls[1].callId);
		});
	});

	suite('tool result round-trip', () => {
		test('collects calls from history and extracts trailing results', () => {
			const call = new vscode.LanguageModelToolCallPart('call-7', 'read_file', { path: 'a.txt' });
			const result = new vscode.LanguageModelToolResultPart('call-7', [
				new vscode.LanguageModelTextPart('file contents here'),
			]);
			const messages = [
				{ role: User, content: [new vscode.LanguageModelTextPart('check a.txt')] },
				{ role: Assistant, content: [call] },
				{ role: User, content: [result] },
			];

			const trailing = extractTrailingToolResults(messages);
			assert.ok(trailing);
			assert.strictEqual(trailing.length, 1);
			assert.strictEqual(trailing[0].callId, 'call-7');

			const calls = collectToolCalls(messages);
			assert.strictEqual(calls.get('call-7')?.name, 'read_file');
		});

		test('ordinary user turns are not tool results', () => {
			const messages = [{ role: User, content: [new vscode.LanguageModelTextPart('plain question')] }];
			assert.strictEqual(extractTrailingToolResults(messages), undefined);
		});
	});

	test('rejectedToolsNote names the tools once each', () => {
		const note = rejectedToolsNote(['run_command', 'run_command']);
		assert.ok(note.includes('`run_command`'));
		assert.strictEqual(note.match(/run_command/g)?.length, 1);
		assert.ok(!note.includes('rewst-buddy.ai'), 'chat rejection note does not mention retired Rewst tool settings');
	});
});
