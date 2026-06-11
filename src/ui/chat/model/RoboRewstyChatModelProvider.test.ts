import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createMockSession, initTestEnvironment } from '@test';
import type { AskOptions, ConversationEvent, Session } from '@sessions';
import vscode from 'vscode';
import { conversationMap } from './conversationMap';
import { RoboRewstyChatModelProvider, type ProviderDeps } from './RoboRewstyChatModelProvider';
import { addOnceApprovals, APPROVAL_TOOL_NAME, takeOnceApprovals, type AiToolSettings } from './lmTools';

const { suite, test, setup } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

const allSettings: AiToolSettings = {
	enableWorkspaceTools: true,
	enableEditTools: true,
	enableWebTools: true,
	enableCommandTool: true,
	enableGraphqlTool: true,
};

function message(
	role: vscode.LanguageModelChatMessageRole,
	content: unknown[],
): vscode.LanguageModelChatRequestMessage {
	return { role, content, name: undefined };
}

function text(value: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(value);
}

function completeTurn(
	content: string,
	conversationId = 'conv-1',
	sources: ConversationEvent[] = [],
): ConversationEvent[] {
	void sources;
	return [
		{ kind: 'conversation', conversationId },
		{ kind: 'chunk', text: content },
		{ kind: 'complete', content, sources: [], conversationId },
	];
}

interface Harness {
	provider: RoboRewstyChatModelProvider;
	captured: AskOptions[];
	parts: vscode.LanguageModelResponsePart[];
	session: Session;
	wrapper: ReturnType<typeof createMockSession>['wrapper'];
	run(messages: vscode.LanguageModelChatRequestMessage[], tools?: vscode.LanguageModelChatTool[]): Promise<void>;
}

function makeHarness(turns: ConversationEvent[][], overrides: Partial<ProviderDeps> = {}): Harness {
	const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Test Org' } } });
	const captured: AskOptions[] = [];
	let turnIndex = 0;
	async function* ask(options: AskOptions): AsyncGenerator<ConversationEvent> {
		captured.push(options);
		const events = turns[Math.min(turnIndex++, turns.length - 1)];
		for (const event of events) yield event;
	}

	const deps: ProviderDeps = {
		ask,
		sessions: () => [session],
		sessionForOrg: () => session,
		confirmApproval: async () => 'approve',
		workspaceOverview: async () => undefined,
		aiConfig: () => ({ customInstructions: '', conversationType: 'HELP_DOCS' }),
		toolSettings: () => allSettings,
		...overrides,
	};

	const provider = new RoboRewstyChatModelProvider(deps);
	const parts: vscode.LanguageModelResponsePart[] = [];
	const progress: vscode.Progress<vscode.LanguageModelResponsePart> = { report: part => parts.push(part) };
	const token = new vscode.CancellationTokenSource().token;
	const model = { id: 'org-1' } as vscode.LanguageModelChatInformation;

	return {
		provider,
		captured,
		parts,
		session,
		wrapper,
		run: (messages, tools) =>
			provider.provideLanguageModelChatResponse(
				model,
				messages,
				{
					tools,
					toolMode: vscode.LanguageModelChatToolMode.Auto,
				} as vscode.ProvideLanguageModelChatResponseOptions,
				progress,
				token,
			),
	};
}

function textOf(parts: vscode.LanguageModelResponsePart[]): string {
	return parts
		.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
		.map(part => part.value)
		.join('');
}

function callsOf(parts: vscode.LanguageModelResponsePart[]): vscode.LanguageModelToolCallPart[] {
	return parts.filter(
		(part): part is vscode.LanguageModelToolCallPart => part instanceof vscode.LanguageModelToolCallPart,
	);
}

const READ_FILE_TOOL: vscode.LanguageModelChatTool = {
	name: 'read_file',
	description: 'read a file',
	inputSchema: { type: 'object' },
};

suite('Unit: RoboRewstyChatModelProvider', () => {
	setup(() => {
		initTestEnvironment();
		conversationMap._resetForTesting();
	});

	test('lists one model per active session org with tool calling', () => {
		const harness = makeHarness([completeTurn('hi')]);
		const models = harness.provider.provideLanguageModelChatInformation(
			{ silent: true },
			new vscode.CancellationTokenSource().token,
		) as vscode.LanguageModelChatInformation[];
		assert.strictEqual(models.length, 1);
		assert.strictEqual(models[0].id, 'org-1');
		assert.strictEqual(models[0].capabilities.toolCalling, true);
	});

	test('streams the answer text through to progress', async () => {
		const harness = makeHarness([completeTurn('Hello there')]);
		await harness.run([message(User, [text('hi')])]);
		assert.strictEqual(textOf(harness.parts), 'Hello there');
		assert.strictEqual(harness.captured[0].conversationId, undefined, 'first turn starts a new conversation');
		assert.strictEqual(harness.captured[0].orgId, 'org-1');
	});

	test('consecutive turns continue the same backend conversation', async () => {
		const harness = makeHarness([completeTurn('Hello'), completeTurn('Again')]);
		await harness.run([message(User, [text('hi')])]);

		// VS Code replays the emitted text as a consolidated assistant message.
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);

		assert.strictEqual(harness.captured.length, 2);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1');
	});

	test('independent chats and orgs keep distinct conversations', async () => {
		const harness = makeHarness([completeTurn('Hello', 'conv-A'), completeTurn('World', 'conv-B')]);
		await harness.run([message(User, [text('chat A opener')])]);
		// A different chat session: different content, also mid-history.
		await harness.run([
			message(User, [text('chat B opener')]),
			message(Assistant, [text('something else')]),
			message(User, [text('next')]),
		]);
		// The second request's prefix matches nothing stored — fresh conversation.
		assert.strictEqual(harness.captured[1].conversationId, undefined);
	});

	test('pending resume binds the next fresh turn, exactly once', async () => {
		conversationMap.setPendingResume('org-1', 'conv-resumed');
		const harness = makeHarness([completeTurn('Continuing', 'conv-resumed'), completeTurn('New topic', 'conv-2')]);

		await harness.run([message(User, [text('where were we?')])]);
		assert.strictEqual(harness.captured[0].conversationId, 'conv-resumed', 'fresh turn consumes the binding');

		await harness.run([message(User, [text('entirely new question')])]);
		assert.strictEqual(harness.captured[1].conversationId, undefined, 'binding does not repeat');
	});

	test('post-resume turns continue the resumed conversation', async () => {
		conversationMap.setPendingResume('org-1', 'conv-resumed');
		const harness = makeHarness([completeTurn('Continuing', 'conv-resumed'), completeTurn('More', 'conv-resumed')]);

		await harness.run([message(User, [text('where were we?')])]);
		await harness.run([
			message(User, [text('where were we?')]),
			message(Assistant, [text('Continuing')]),
			message(User, [text('go on')]),
		]);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-resumed');
	});

	test('advertises permitted tools and emits tool calls from rewst-tool fences', async () => {
		const reply = 'Let me check.\n```rewst-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
		const harness = makeHarness([completeTurn(reply)]);
		await harness.run([message(User, [text('check a.txt')])], [READ_FILE_TOOL]);

		assert.ok(harness.captured[0].message.includes('read_file'), 'tool instructions injected');
		const calls = callsOf(harness.parts);
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].name, 'read_file');
		assert.deepStrictEqual(calls[0].input, { path: 'a.txt' });
		assert.ok(!textOf(harness.parts).includes('rewst-tool'), 'fence never renders');
	});

	test('a disabled setting withholds the tool even when VS Code passes it', async () => {
		const harness = makeHarness([completeTurn('plain answer')], {
			toolSettings: () => ({ ...allSettings, enableWorkspaceTools: false }),
		});
		await harness.run([message(User, [text('check a.txt')])], [READ_FILE_TOOL]);
		assert.ok(!harness.captured[0].message.includes('read_file'), 'withheld from instructions');
	});

	test('an out-of-set tool request becomes text, never a stalled call', async () => {
		const reply = '```rewst-tool\n{"tool": "run_command", "args": {"command": "ls"}}\n```';
		const harness = makeHarness([completeTurn(reply)]);
		await harness.run([message(User, [text('list files')])], [READ_FILE_TOOL]);

		assert.strictEqual(callsOf(harness.parts).length, 0);
		assert.ok(textOf(harness.parts).includes('run_command'), 'rejection note names the tool');
	});

	test('tool results round-trip into the same conversation', async () => {
		const reply = 'Let me check.\n```rewst-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
		const harness = makeHarness([completeTurn(reply), completeTurn('It says hello.')]);

		const ask1 = [message(User, [text('check a.txt')])];
		await harness.run(ask1, [READ_FILE_TOOL]);
		const [call] = callsOf(harness.parts);
		assert.ok(call);

		// VS Code's follow-up: emitted assistant parts + the tool result.
		const askText = textOf(harness.parts);
		await harness.run(
			[
				...ask1,
				message(Assistant, [text(askText), call]),
				message(User, [new vscode.LanguageModelToolResultPart(call.callId, [text('file contents')])]),
			],
			[READ_FILE_TOOL],
		);

		assert.strictEqual(harness.captured[1].conversationId, 'conv-1', 'tool round stays in the conversation');
		assert.ok(harness.captured[1].message.includes('Tool results:'));
		assert.ok(harness.captured[1].message.includes('file contents'));
		assert.ok(harness.captured[1].message.includes('read_file'));
	});

	test('with the approval tool available, an approval pause becomes an in-chat tool call', async () => {
		const approvalTool: vscode.LanguageModelChatTool = {
			name: APPROVAL_TOOL_NAME,
			description: 'internal approval surface',
		};
		const harness = makeHarness(
			[
				[
					{ kind: 'conversation', conversationId: 'conv-1' },
					{ kind: 'approval', tools: [{ name: 'send_email', args: { to: 'a@b.c' } }], raw: {} },
				],
			],
			{
				confirmApproval: async () => {
					throw new Error('modal must not open when the in-chat surface is available');
				},
			},
		);

		await harness.run([message(User, [text('send the email')])], [approvalTool]);

		const calls = callsOf(harness.parts);
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].name, APPROVAL_TOOL_NAME);
		const input = calls[0].input as { toolNames: string[]; orgId: string; resume: string };
		assert.deepStrictEqual(input.toolNames, ['send_email']);
		assert.strictEqual(input.orgId, 'org-1');
		assert.strictEqual(input.resume, harness.captured[0].message, 'resume carries the original request');
	});

	test('a confirmed in-chat approval resumes the original request in the same conversation', async () => {
		const approvalTool: vscode.LanguageModelChatTool = {
			name: APPROVAL_TOOL_NAME,
			description: 'internal approval surface',
		};
		const harness = makeHarness([
			[
				{ kind: 'conversation', conversationId: 'conv-1' },
				{ kind: 'approval', tools: [{ name: 'send_email' }], raw: {} },
			],
			completeTurn('Email sent.'),
		]);
		harness.wrapper.when('removeAllowedTool', { data: { removeAllowedTool: { id: 'p', alwaysAllowedTools: [] } } });

		const ask1 = [message(User, [text('send the email')])];
		await harness.run(ask1, [approvalTool]);
		const [call] = callsOf(harness.parts);
		assert.ok(call);

		// The user clicked Continue: the approval tool ran (allow-listing +
		// marking the once-approval), and VS Code hands back the result.
		addOnceApprovals('org-1', ['send_email']);
		await harness.run(
			[
				...ask1,
				message(Assistant, [call]),
				message(User, [new vscode.LanguageModelToolResultPart(call.callId, [text('Approved')])]),
			],
			[approvalTool],
		);

		assert.strictEqual(harness.captured[1].message, harness.captured[0].message, 'original request re-sent');
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1');
		assert.ok(textOf(harness.parts).includes('Email sent.'));
		assert.strictEqual(harness.wrapper.getCallsFor('removeAllowedTool').length, 1, 'once-approval reverted');
		assert.deepStrictEqual(takeOnceApprovals('org-1'), [], 'revert set drained');
	});

	test('continuation rounds start on a new paragraph', async () => {
		const reply = 'Checking.\n```rewst-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
		const harness = makeHarness([completeTurn(reply), completeTurn('It says hello.')]);

		const ask1 = [message(User, [text('check a.txt')])];
		await harness.run(ask1, [READ_FILE_TOOL]);
		const [call] = callsOf(harness.parts);
		const firstText = textOf(harness.parts);

		await harness.run(
			[
				...ask1,
				message(Assistant, [text(firstText), call]),
				message(User, [new vscode.LanguageModelToolResultPart(call.callId, [text('hello')])]),
			],
			[READ_FILE_TOOL],
		);

		const continuation = textOf(harness.parts).slice(firstText.length);
		assert.ok(
			continuation.startsWith('\n\n'),
			`continuation starts with a paragraph break, got: ${JSON.stringify(continuation.slice(0, 10))}`,
		);
	});

	test('approval pauses resolve via the modal and re-ask; approve-once reverts', async () => {
		const harness = makeHarness([
			[
				{ kind: 'conversation', conversationId: 'conv-1' },
				{ kind: 'approval', tools: [{ name: 'send_email' }], raw: {} },
			],
			completeTurn('Email sent.'),
		]);
		harness.wrapper
			.when('addAllowedTool', { data: { addAllowedTool: { id: 'p', alwaysAllowedTools: ['send_email'] } } })
			.when('removeAllowedTool', { data: { removeAllowedTool: { id: 'p', alwaysAllowedTools: [] } } });

		await harness.run([message(User, [text('send the email')])]);

		assert.strictEqual(harness.wrapper.getCallsFor('addAllowedTool').length, 1);
		assert.strictEqual(harness.wrapper.getCallsFor('removeAllowedTool').length, 1, 'approve-once reverts');
		assert.strictEqual(harness.captured.length, 2, 'request re-asked after allow-listing');
		assert.strictEqual(harness.captured[1].message, harness.captured[0].message);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1');
		assert.ok(textOf(harness.parts).includes('Email sent.'));
	});

	test('always-allow keeps the tool allow-listed', async () => {
		const harness = makeHarness(
			[[{ kind: 'approval', tools: [{ name: 'send_email' }], raw: {} }], completeTurn('Done.')],
			{ confirmApproval: async () => 'always' },
		);
		harness.wrapper.when('addAllowedTool', {
			data: { addAllowedTool: { id: 'p', alwaysAllowedTools: ['send_email'] } },
		});

		await harness.run([message(User, [text('send it')])]);
		assert.strictEqual(harness.wrapper.getCallsFor('addAllowedTool').length, 1);
		assert.strictEqual(harness.wrapper.getCallsFor('removeAllowedTool').length, 0);
	});

	test('declined approval ends the turn without running anything', async () => {
		const harness = makeHarness([[{ kind: 'approval', tools: [{ name: 'send_email' }], raw: {} }]], {
			confirmApproval: async () => 'cancel',
		});
		await harness.run([message(User, [text('send it')])]);
		assert.strictEqual(harness.captured.length, 1, 'no re-ask');
		assert.ok(textOf(harness.parts).includes('Approval declined'));
	});

	test('sources render as a markdown section on final answers', async () => {
		const harness = makeHarness([
			[
				{ kind: 'chunk', text: 'See the docs.' },
				{
					kind: 'complete',
					content: 'See the docs.',
					sources: [
						{ label: 'Rewst Docs', source: 'https://docs.rewst.help/x', section: 'Jinja' },
						{ label: 'Internal note', source: 'note-1' },
					],
					conversationId: 'conv-1',
				},
			],
		]);
		await harness.run([message(User, [text('how do I…')])]);
		const rendered = textOf(harness.parts);
		assert.ok(rendered.includes('**Sources**'));
		assert.ok(rendered.includes('[Rewst Docs](https://docs.rewst.help/x) — Jinja'));
		assert.ok(rendered.includes('- Internal note'));
	});

	test('backend errors surface as thrown errors', async () => {
		const harness = makeHarness([[{ kind: 'error', message: 'boom' }]]);
		await assert.rejects(() => harness.run([message(User, [text('hi')])]), /boom/);
	});

	test('custom instructions are prepended to the outgoing message', async () => {
		const harness = makeHarness([completeTurn('ok')], {
			aiConfig: () => ({ customInstructions: 'answer in haiku', conversationType: 'HELP_DOCS' }),
		});
		await harness.run([message(User, [text('hi')])]);
		assert.ok(harness.captured[0].message.startsWith("User's standing instructions: answer in haiku"));
	});
});
