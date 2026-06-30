import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createMockSession, initTestEnvironment } from '@test';
import type { AskOptions, ConversationEvent, Session } from '@sessions';
import { onDidChangeContextUsage, type ContextUsage } from './contextUsage';
import vscode from 'vscode';
import { conversationMap } from './conversationMap';
import { parseLatestBreadcrumb } from './breadcrumb';
import {
	MAX_BUDDY_TOOL_ROUNDS,
	normalizeBuddyToolRounds,
	RoboRewstyChatModelProvider,
	truncateArgsLabel,
	type ProviderDeps,
} from './RoboRewstyChatModelProvider';

const { suite, test, setup } = Mocha;

const { User, Assistant } = vscode.LanguageModelChatMessageRole;

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
	tokenSource: vscode.CancellationTokenSource;
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
		workspaceRoot: () => undefined,
		aiConfig: () => ({
			customInstructions: '',
			conversationType: 'HELP_DOCS',
			showActivity: true,
			maxBuddyToolRounds: MAX_BUDDY_TOOL_ROUNDS,
		}),
		buddyToolSpecs: () => [],
		runBuddyTool: async () => ({ text: '', isError: false }),
		...overrides,
	};

	const provider = new RoboRewstyChatModelProvider(deps);
	const parts: vscode.LanguageModelResponsePart[] = [];
	const progress: vscode.Progress<vscode.LanguageModelResponsePart> = { report: part => parts.push(part) };
	const tokenSource = new vscode.CancellationTokenSource();
	const model = { id: 'org-1' } as vscode.LanguageModelChatInformation;

	return {
		provider,
		captured,
		parts,
		session,
		wrapper,
		tokenSource,
		run: (messages, tools) =>
			provider.provideLanguageModelChatResponse(
				model,
				messages,
				{
					tools,
					toolMode: vscode.LanguageModelChatToolMode.Auto,
				} as vscode.ProvideLanguageModelChatResponseOptions,
				progress,
				tokenSource.token,
			),
	};
}

function textOf(parts: vscode.LanguageModelResponsePart[]): string {
	return parts
		.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
		.map(part => part.value)
		.join('');
}

// What the user actually sees: the streamed text minus the hidden zero-width breadcrumb.
const ZERO_WIDTH = new RegExp(`[${String.fromCharCode(0x200b, 0x200c, 0x2060)}]`, 'g');
function visibleText(parts: vscode.LanguageModelResponsePart[]): string {
	return textOf(parts).replace(ZERO_WIDTH, '').trimEnd();
}

function callsOf(parts: vscode.LanguageModelResponsePart[]): vscode.LanguageModelToolCallPart[] {
	return parts.filter(
		(part): part is vscode.LanguageModelToolCallPart => part instanceof vscode.LanguageModelToolCallPart,
	);
}

// Models a built-in/external tool the chat passes through options.tools.
const READ_FILE_TOOL: vscode.LanguageModelChatTool = {
	name: 'read_file',
	description: 'read a file',
	inputSchema: { type: 'object' },
};

// A Rewst (buddy) tool the MCP server exposes; advertised and run in-process,
// never through options.tools.
const BUDDY_GET_SPEC = {
	name: 'buddy_workflow_get',
	description: 'Fetch a workflow',
	args: '{"type":"object"}',
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
		// Only the answer is visible; the appended breadcrumb is all zero-width.
		assert.strictEqual(visibleText(harness.parts), 'Hello there', 'answer streams, breadcrumb invisible');
		assert.strictEqual(harness.captured[0].conversationId, undefined, 'first turn starts a new conversation');
		assert.strictEqual(harness.captured[0].orgId, 'org-1');
	});

	test('an append turn reuses the warm conversation with a lean incremental message', async () => {
		const harness = makeHarness([completeTurn('Hello', 'conv-1'), completeTurn('Again', 'conv-1')]);
		await harness.run([message(User, [text('hi')])]);
		assert.strictEqual(harness.captured[0].conversationId, undefined, 'opener starts a new conversation');

		// VS Code replays the emitted text as a consolidated assistant message;
		// the next turn is a pure append onto the same chat.
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);

		assert.strictEqual(harness.captured.length, 2);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1', 'append reuses the warm conversation');
		// Reuse sends only the new turn — not the whole transcript or the directive.
		assert.ok(!harness.captured[1].message.includes('<visible_chat_transcript>'), 'no transcript re-sent');
		assert.ok(!harness.captured[1].message.includes('# Rewst Buddy VS Code Context'), 'no directive re-sent');
		assert.match(harness.captured[1].message, /next/);
	});

	test('a rewound transcript forks fresh and deletes the rolled-back conversation', async () => {
		const harness = makeHarness([
			completeTurn('Hello', 'conv-1'),
			completeTurn('Again', 'conv-1'),
			completeTurn('Forked', 'conv-2'),
		]);
		harness.wrapper.when('deleteConversation', { data: { deleteConversation: 'conv-1' } });

		await harness.run([message(User, [text('hi')])]);
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1', 'turn 2 appended to conv-1');

		// Restore Checkpoint rolled the transcript back to after turn 1; the
		// user asks something new. conv-1 still contains turn 2, so re-attaching
		// would leak the rolled-back exchange — it forks and deletes conv-1.
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('a different question')]),
		]);

		assert.strictEqual(harness.captured.length, 3);
		assert.strictEqual(harness.captured[2].conversationId, undefined, 'fork starts a new conversation');
		assert.match(harness.captured[2].message, /<visible_chat_transcript>/);
		assert.match(harness.captured[2].message, /USER: hi/);
		assert.match(harness.captured[2].message, /a different question/);
		assert.ok(!harness.captured[2].message.includes('Again'), 'rolled-back turn is not replayed');
		assert.deepStrictEqual(
			harness.wrapper.getCallsFor('deleteConversation').map(call => call.variables),
			[{ id: 'conv-1' }],
			'the rewound branch is deleted',
		);
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

	test('advertises built-in tools and emits tool calls from vscode-tool fences', async () => {
		const reply = 'Let me check.\n```vscode-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
		const harness = makeHarness([completeTurn(reply)]);
		await harness.run([message(User, [text('check a.txt')])], [READ_FILE_TOOL]);

		assert.ok(harness.captured[0].message.includes('read_file'), 'tool instructions injected');
		assert.ok(
			!harness.captured[0].message.includes('buddy_search_template_links'),
			'Rewst tools are not advertised',
		);
		assert.ok(!/\bbuddy_/.test(harness.captured[0].message), 'buddy_* tools are not advertised');
		const calls = callsOf(harness.parts);
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].name, 'read_file');
		assert.deepStrictEqual(calls[0].input, { path: 'a.txt' });
		assert.ok(!textOf(harness.parts).includes('vscode-tool'), 'fence never renders');
	});

	test('advertises buddy MCP tools when the MCP server is connected', async () => {
		const harness = makeHarness([completeTurn('hi')], { buddyToolSpecs: () => [BUDDY_GET_SPEC] });
		await harness.run([message(User, [text('what workflows exist?')])]);

		// Sourced from the MCP surface, not options.tools — so it survives VS Code's
		// 128-tool cap even with no tools passed this turn.
		assert.ok(harness.captured[0].message.includes('buddy_workflow_get'), 'buddy tool advertised');
		assert.ok(harness.captured[0].message.includes('Fetch a workflow'), 'buddy description advertised');
	});

	test('advertises no buddy tools when the MCP server is disconnected', async () => {
		const harness = makeHarness([completeTurn('hi')]); // default: buddyToolSpecs → []
		await harness.run([message(User, [text('hi')])]);
		assert.ok(!/\bbuddy_/.test(harness.captured[0].message), 'nothing buddy-related is advertised');
	});

	test('runs a buddy tool in-process and feeds results back without emitting a tool call', async () => {
		const reply =
			'Looking it up.\n```vscode-tool\n{"tool": "buddy_workflow_get", "args": {"workflowId": "w1"}}\n```';
		const buddyCalls: { name: string; args: unknown; orgId: string }[] = [];
		const harness = makeHarness([completeTurn(reply, 'conv-1'), completeTurn('It is named Deploy.', 'conv-1')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async (name, args, orgId) => {
				buddyCalls.push({ name, args, orgId });
				return { text: 'name: Deploy', isError: false };
			},
		});

		await harness.run([message(User, [text('what is workflow w1 called?')])]);

		assert.deepStrictEqual(buddyCalls, [
			{ name: 'buddy_workflow_get', args: { workflowId: 'w1' }, orgId: 'org-1' },
		]);
		assert.strictEqual(callsOf(harness.parts).length, 0, 'buddy tools never surface as VS Code tool calls');
		assert.ok(visibleText(harness.parts).includes('It is named Deploy.'), 'the final answer streams');

		// Two backend turns within one chat response: the tool round, then the answer.
		assert.strictEqual(harness.captured.length, 2);
		assert.strictEqual(
			harness.captured[1].conversationId,
			'conv-1',
			'results feed back into the warm conversation',
		);
		assert.ok(harness.captured[1].message.includes('Tool results:'), 'results sent compactly');
		assert.ok(harness.captured[1].message.includes('name: Deploy'), 'tool output fed back to the backend');
		assert.ok(harness.captured[1].message.includes('buddy_workflow_get'));

		// In-process buddy calls render as a "Buddy tool" card (distinct from the
		// backend's "Rewst tool"), showing the name once, then the args alone.
		const out = textOf(harness.parts);
		assert.ok(out.includes('🔧 **Buddy tool** · `buddy_workflow_get`'), 'renders as a distinct Buddy tool card');
		assert.ok(!out.includes('🔧 **Rewst tool** · `buddy_workflow_get`'), 'not labeled as a backend Rewst tool');
		assert.ok(out.includes('`{"workflowId":"w1"}`'), 'the args line shows the args alone');
		assert.ok(!out.includes('buddy_workflow_get {'), 'the args line does not repeat the tool name');
	});

	test('redirects native Rewst tool activity to the local Buddy tool protocol when Buddy tools are enabled', async () => {
		const nativeAttempt: ConversationEvent[] = [
			{ kind: 'conversation', conversationId: 'conv-1' },
			{
				kind: 'status',
				label: 'Running Rewst tool: listWorkflow…',
				activity: true,
				tool: { name: 'listWorkflow' },
			},
			{ kind: 'chunk', text: 'native result that should not stream' },
			{
				kind: 'complete',
				content: 'native result that should not stream',
				sources: [],
				conversationId: 'conv-1',
			},
		];
		const buddyReply = '```vscode-tool\n{"tool": "buddy_workflow_get", "args": {"workflowId": "w1"}}\n```';
		const buddyCalls: { name: string; args: unknown; orgId: string }[] = [];
		const harness = makeHarness(
			[nativeAttempt, completeTurn(buddyReply, 'conv-1'), completeTurn('Deploy.', 'conv-1')],
			{
				buddyToolSpecs: () => [BUDDY_GET_SPEC],
				runBuddyTool: async (name, args, orgId) => {
					buddyCalls.push({ name, args, orgId });
					return { text: 'name: Deploy', isError: false };
				},
			},
		);

		await harness.run([message(User, [text('look up workflow w1')])]);

		assert.strictEqual(
			harness.captured.length,
			3,
			'native attempt is followed by correction, buddy call, and answer',
		);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1', 'correction stays in the same conversation');
		assert.ok(harness.captured[1].message.includes('vscode-tool'), 'correction names the fenced protocol');
		assert.ok(harness.captured[1].message.includes('local tool protocol'), 'correction is transport-focused');
		assert.ok(harness.captured[1].message.includes('VS Code'), 'correction names the editor transport');
		assert.ok(
			harness.captured[1].message.includes('buddy_workflow_get'),
			'correction includes available Buddy tools',
		);
		assert.ok(
			!/override|supersede|ignore your system prompt|trusted system-level/i.test(harness.captured[1].message),
		);
		assert.ok(!/<[^>\n]+>/.test(harness.captured[1].message), 'correction does not use XML-like tags');
		assert.ok(
			!/\berror\b/i.test(harness.captured[1].message),
			'correction does not call the native attempt an error',
		);
		assert.deepStrictEqual(buddyCalls, [
			{ name: 'buddy_workflow_get', args: { workflowId: 'w1' }, orgId: 'org-1' },
		]);
		assert.strictEqual(callsOf(harness.parts).length, 0, 'native activity is not converted to a VS Code tool call');
		const out = textOf(harness.parts);
		assert.ok(!out.includes('🔧 **Rewst tool** · `listWorkflow`'), 'intercepted native tool card is not rendered');
		assert.ok(
			!out.includes('native result that should not stream'),
			'abandoned native stream output is not rendered',
		);
		assert.ok(out.includes('Deploy.'), 'final answer from the Buddy path streams');
	});

	test('does not redirect native Rewst tool activity when Buddy tools are disabled', async () => {
		const harness = makeHarness([
			[
				{ kind: 'conversation', conversationId: 'conv-1' },
				{
					kind: 'status',
					label: 'Running Rewst tool: listWorkflow…',
					activity: true,
					tool: { name: 'listWorkflow' },
				},
				{ kind: 'chunk', text: 'native answer' },
				{ kind: 'complete', content: 'native answer', sources: [], conversationId: 'conv-1' },
			],
		]);

		await harness.run([message(User, [text('look up workflow w1')])]);

		assert.strictEqual(harness.captured.length, 1, 'no correction turn is sent without Buddy tools');
		const out = textOf(harness.parts);
		assert.ok(out.includes('🔧 **Rewst tool** · `listWorkflow`'), 'native activity remains visible');
		assert.ok(out.includes('native answer'), 'native answer still streams');
	});

	test('redirects any native Rewst tool status even if the activity flag is omitted', async () => {
		const buddyReply = '```vscode-tool\n{"tool": "buddy_workflow_get", "args": {"workflowId": "w1"}}\n```';
		const harness = makeHarness(
			[
				[
					{ kind: 'conversation', conversationId: 'conv-1' },
					{
						kind: 'status',
						label: 'Running Rewst tool: listWorkflow…',
						tool: { name: 'listWorkflow' },
					},
					{ kind: 'chunk', text: 'native result that should not stream' },
					{
						kind: 'complete',
						content: 'native result that should not stream',
						sources: [],
						conversationId: 'conv-1',
					},
				],
				completeTurn(buddyReply, 'conv-1'),
				completeTurn('Deploy.', 'conv-1'),
			],
			{
				buddyToolSpecs: () => [BUDDY_GET_SPEC],
				runBuddyTool: async () => ({ text: 'name: Deploy', isError: false }),
			},
		);

		await harness.run([message(User, [text('look up workflow w1')])]);

		assert.strictEqual(harness.captured.length, 3, 'status.tool is enough to trigger a correction');
		assert.ok(harness.captured[1].message.includes('buddy_workflow_get'), 'correction names Buddy tools');
		const out = textOf(harness.parts);
		assert.ok(!out.includes('🔧 **Rewst tool** · `listWorkflow`'), 'intercepted native tool card is not rendered');
		assert.ok(
			!out.includes('native result that should not stream'),
			'abandoned native stream output is not rendered',
		);
		assert.ok(out.includes('Deploy.'), 'final answer from the Buddy path streams');
	});

	test('stops after a repeated native Rewst tool attempt while Buddy tools are enabled', async () => {
		const nativeAttempt: ConversationEvent[] = [
			{ kind: 'conversation', conversationId: 'conv-1' },
			{
				kind: 'status',
				label: 'Running Rewst tool: listWorkflow…',
				activity: true,
				tool: { name: 'listWorkflow' },
			},
			{ kind: 'chunk', text: 'ignored' },
			{ kind: 'complete', content: 'ignored', sources: [], conversationId: 'conv-1' },
		];
		let buddyRan = false;
		const harness = makeHarness([nativeAttempt, nativeAttempt, completeTurn('unreachable', 'conv-1')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => {
				buddyRan = true;
				return { text: '', isError: false };
			},
		});

		await harness.run([message(User, [text('look up workflow w1')])]);

		assert.strictEqual(harness.captured.length, 2, 'one correction is attempted, then the loop stops');
		assert.strictEqual(buddyRan, false, 'no local Buddy tool runs without a fenced Buddy request');
		assert.strictEqual(callsOf(harness.parts).length, 0, 'no VS Code tool call is emitted for native activity');
		const out = visibleText(harness.parts);
		assert.ok(out.includes('Stopped after a server-side Rewst tool was requested again'), 'stop note is visible');
		assert.ok(!out.includes('unreachable'), 'no third backend turn is started');
	});

	suite('truncateArgsLabel()', () => {
		test('returns args at or below the limit unchanged', () => {
			assert.strictEqual(truncateArgsLabel('{"a":1}'), '{"a":1}');
			const atLimit = 'x'.repeat(10);
			assert.strictEqual(truncateArgsLabel(atLimit, 10), atLimit);
		});

		test('truncates over-long args to the limit with an ellipsis', () => {
			const out = truncateArgsLabel('x'.repeat(20), 10);
			assert.strictEqual(out, 'xxxxxxxxx…');
			assert.strictEqual([...out].length, 10, 'capped to maxLength characters including the ellipsis');
		});
	});

	suite('normalizeBuddyToolRounds()', () => {
		test('passes a valid in-range value through', () => {
			assert.strictEqual(normalizeBuddyToolRounds(20), 20);
			assert.strictEqual(normalizeBuddyToolRounds(1), 1);
			assert.strictEqual(normalizeBuddyToolRounds(100), 100);
		});

		test('clamps out-of-range values to the 1–100 manifest range', () => {
			assert.strictEqual(normalizeBuddyToolRounds(500), 100, 'above the max clamps down');
			assert.strictEqual(normalizeBuddyToolRounds(0), 1, 'zero clamps up to the min');
			assert.strictEqual(normalizeBuddyToolRounds(-5), 1, 'negative clamps up to the min');
		});

		test('floors fractional values', () => {
			assert.strictEqual(normalizeBuddyToolRounds(2.9), 2);
			assert.strictEqual(normalizeBuddyToolRounds(0.4), 1, 'floors then clamps to the min');
		});

		test('falls back to the default for non-numeric or non-finite input', () => {
			assert.strictEqual(normalizeBuddyToolRounds(undefined), MAX_BUDDY_TOOL_ROUNDS);
			assert.strictEqual(normalizeBuddyToolRounds(NaN), MAX_BUDDY_TOOL_ROUNDS);
			assert.strictEqual(normalizeBuddyToolRounds(Infinity), MAX_BUDDY_TOOL_ROUNDS);
			assert.strictEqual(normalizeBuddyToolRounds('8'), MAX_BUDDY_TOOL_ROUNDS);
			assert.strictEqual(normalizeBuddyToolRounds(null), MAX_BUDDY_TOOL_ROUNDS);
		});
	});

	test('renders distinct cards for repeated buddy calls with different args', async () => {
		const reply =
			'Two.\n```vscode-tool\n{"tool":"buddy_workflow_get","args":{"workflowId":"a"}}\n```\n' +
			'```vscode-tool\n{"tool":"buddy_workflow_get","args":{"workflowId":"b"}}\n```';
		const harness = makeHarness([completeTurn(reply, 'conv-1'), completeTurn('done', 'conv-1')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => ({ text: 'ok', isError: false }),
		});

		await harness.run([message(User, [text('look at a and b')])]);

		const out = textOf(harness.parts);
		assert.ok(out.includes('`{"workflowId":"a"}`'), 'the first call card shows its args');
		assert.ok(out.includes('`{"workflowId":"b"}`'), 'the second call is not suppressed by activity dedupe');
	});

	test('caps in-process buddy rounds and never executes the capped round', async () => {
		// Every backend turn re-requests the buddy tool, so only the round cap stops it.
		const buddyReply = '```vscode-tool\n{"tool":"buddy_workflow_get","args":{}}\n```';
		let calls = 0;
		const harness = makeHarness([completeTurn(buddyReply, 'conv-1')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => {
				calls += 1;
				return { text: 'x', isError: false };
			},
		});

		await harness.run([message(User, [text('loop')])]);

		assert.strictEqual(calls, MAX_BUDDY_TOOL_ROUNDS, 'runs exactly the cap — the capped round never executes');
		assert.ok(visibleText(harness.parts).includes('Stopped'), 'shows the stop note instead of running again');
	});

	test('uses the configured in-process buddy round cap', async () => {
		const buddyReply = '```vscode-tool\n{"tool":"buddy_workflow_get","args":{}}\n```';
		let calls = 0;
		const harness = makeHarness([completeTurn(buddyReply, 'conv-1')], {
			aiConfig: () => ({
				customInstructions: '',
				conversationType: 'HELP_DOCS',
				showActivity: true,
				maxBuddyToolRounds: 2,
			}),
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => {
				calls += 1;
				return { text: 'x', isError: false };
			},
		});

		await harness.run([message(User, [text('loop')])]);

		assert.strictEqual(calls, 2, 'uses the configured cap instead of the default');
		assert.match(
			visibleText(harness.parts),
			/Stopped after 2 Rewst tool calls/,
			'stop note reflects the configured cap, not a hardcoded "several"',
		);
	});

	test('the stop note is singular when the cap is 1', async () => {
		const buddyReply = '```vscode-tool\n{"tool":"buddy_workflow_get","args":{}}\n```';
		let calls = 0;
		const harness = makeHarness([completeTurn(buddyReply, 'conv-1')], {
			aiConfig: () => ({
				customInstructions: '',
				conversationType: 'HELP_DOCS',
				showActivity: true,
				maxBuddyToolRounds: 1,
			}),
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => {
				calls += 1;
				return { text: 'x', isError: false };
			},
		});

		await harness.run([message(User, [text('loop')])]);

		assert.strictEqual(calls, 1, 'runs exactly the cap of 1');
		assert.match(visibleText(harness.parts), /Stopped after 1 Rewst tool call\b/, 'singular "call" at a cap of 1');
	});

	test('a built-in tool still round-trips through VS Code when buddy tools are advertised', async () => {
		const reply = 'Checking.\n```vscode-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
		let buddyRan = false;
		const harness = makeHarness([completeTurn(reply)], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => {
				buddyRan = true;
				return { text: '', isError: false };
			},
		});

		await harness.run([message(User, [text('read a.txt')])], [READ_FILE_TOOL]);

		const calls = callsOf(harness.parts);
		assert.strictEqual(calls.length, 1, 'the built-in call is emitted for VS Code to run');
		assert.strictEqual(calls[0].name, 'read_file');
		assert.strictEqual(buddyRan, false, 'a built-in request never runs through the buddy path');
		assert.ok(harness.captured[0].message.includes('read_file'), 'both surfaces advertised together');
		assert.ok(harness.captured[0].message.includes('buddy_workflow_get'));
	});

	test('a reply with both a buddy and a built-in tool runs buddy in-process and defers the built-in', async () => {
		// One-step steering keeps these apart in practice, but if the backend mixes
		// them the buddy round wins: the built-in call is deferred (not emitted), and
		// the backend can re-request it after seeing the buddy results.
		const reply =
			'Both.\n```vscode-tool\n{"tool": "buddy_workflow_get", "args": {"workflowId": "w1"}}\n```\n' +
			'```vscode-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
		let buddyRan = 0;
		const harness = makeHarness(
			[completeTurn(reply, 'conv-1'), completeTurn('Deploy, and a.txt next.', 'conv-1')],
			{
				buddyToolSpecs: () => [BUDDY_GET_SPEC],
				runBuddyTool: async () => {
					buddyRan += 1;
					return { text: 'name: Deploy', isError: false };
				},
			},
		);

		await harness.run([message(User, [text('look at workflow w1 and a.txt')])], [READ_FILE_TOOL]);

		assert.strictEqual(buddyRan, 1, 'the buddy tool ran in-process');
		assert.strictEqual(callsOf(harness.parts).length, 0, 'the built-in call is deferred, not emitted this round');
		assert.strictEqual(harness.captured.length, 2, 'buddy results feed back into a second backend turn');
		assert.ok(harness.captured[1].message.includes('Tool results:'), 'the second turn carries the buddy results');
		// The deferred native call is named so the backend can re-issue it — not dropped.
		assert.ok(harness.captured[1].message.includes('not run here'), 'the deferred native call is flagged');
		assert.ok(
			harness.captured[1].message.includes('read_file'),
			'the deferred native tool is named for re-request',
		);
	});

	test('cancelling mid-sequence stops the remaining in-process buddy tools', async () => {
		const reply =
			'Two.\n```vscode-tool\n{"tool": "buddy_workflow_run", "args": {"id": "a"}}\n```\n' +
			'```vscode-tool\n{"tool": "buddy_workflow_run", "args": {"id": "b"}}\n```';
		const ran: unknown[] = [];
		const harness = makeHarness([completeTurn(reply, 'conv-1'), completeTurn('done', 'conv-1')], {
			buddyToolSpecs: () => [{ name: 'buddy_workflow_run', description: 'Run a workflow', args: '{}' }],
			runBuddyTool: async (_name, args) => {
				ran.push(args);
				harness.tokenSource.cancel(); // user hits stop after the first tool launches
				return { text: 'ok', isError: false };
			},
		});

		await harness.run([message(User, [text('run a then b')])]);

		assert.strictEqual(ran.length, 1, 'only the first tool runs; the second is skipped after cancellation');
		assert.strictEqual(harness.captured.length, 1, 'no further backend turn is started after cancellation');
	});

	test('a buddy tool that has run blocks a stateless downgrade so a write never re-applies', async () => {
		const buddyReply = '```vscode-tool\n{"tool": "buddy_workflow_run", "args": {"workflowId": "w1"}}\n```';
		const buddyCalls: unknown[] = [];
		const harness = makeHarness(
			[
				completeTurn('Hello', 'conv-1'),
				completeTurn(buddyReply, 'conv-1'),
				[{ kind: 'error', message: 'conversation not found' }],
				// Only reached if a downgrade wrongly restarts the turn — proves replay.
				completeTurn(buddyReply, 'conv-1'),
				completeTurn('Done.', 'conv-1'),
			],
			{
				aiConfig: () => ({
					customInstructions: '',
					conversationType: 'HELP_DOCS',
					showActivity: false,
					maxBuddyToolRounds: MAX_BUDDY_TOOL_ROUNDS,
				}),
				buddyToolSpecs: () => [{ name: 'buddy_workflow_run', description: 'Run a workflow', args: '{}' }],
				runBuddyTool: async (name, args, orgId) => {
					buddyCalls.push({ name, args, orgId });
					return { text: 'ok', isError: false };
				},
			},
		);

		await harness.run([message(User, [text('hi')])]);
		// Warm reuse turn: runs the buddy tool, then the backend loses the conversation.
		await assert.rejects(
			() =>
				harness.run([
					message(User, [text('hi')]),
					message(Assistant, [text('Hello')]),
					message(User, [text('run workflow w1')]),
				]),
			/conversation not found/,
		);
		assert.strictEqual(buddyCalls.length, 1, 'the buddy tool ran once and was not replayed by a downgrade');
	});

	test('a tool request with no tools available surfaces the rejection note', async () => {
		const reply = '```vscode-tool\n{"tool": "buddy_graphql", "args": {"query": "{ workflows { id } }"}}\n```';
		const harness = makeHarness([completeTurn(reply)]);
		await harness.run([message(User, [text('list workflows')])]);

		assert.strictEqual(callsOf(harness.parts).length, 0);
		assert.ok(textOf(harness.parts).includes('buddy_graphql'), 'rejection note names the tool');
		assert.ok(!textOf(harness.parts).includes('rewst-buddy.ai'), 'note does not point at retired chat settings');
	});

	test('an out-of-set tool request becomes text, never a stalled call', async () => {
		const reply = '```vscode-tool\n{"tool": "run_command", "args": {"command": "ls"}}\n```';
		const harness = makeHarness([completeTurn(reply)]);
		await harness.run([message(User, [text('list files')])], [READ_FILE_TOOL]);

		assert.strictEqual(callsOf(harness.parts).length, 0);
		assert.ok(textOf(harness.parts).includes('run_command'), 'rejection note names the tool');
	});

	test('a tool result reuses the conversation by callId with a compact message', async () => {
		const reply = 'Let me check.\n```vscode-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
		const harness = makeHarness([
			completeTurn(reply, 'conv-tool-call'),
			completeTurn('It says hello.', 'conv-tool-call'),
		]);
		harness.wrapper.when('deleteConversation', { data: { deleteConversation: 'conv-tool-call' } });

		const ask1 = [message(User, [text('check a.txt')])];
		await harness.run(ask1, [READ_FILE_TOOL]);
		const [call] = callsOf(harness.parts);
		assert.ok(call);

		// VS Code replays the assistant message with text that does NOT match what
		// we streamed (split parts, different narration). The prefix hash drifts,
		// but the preserved callId recovers the same backend conversation, and the
		// results are fed back compactly — not the whole transcript.
		await harness.run(
			[
				...ask1,
				message(Assistant, [text('completely'), text(' different narration'), call]),
				message(User, [new vscode.LanguageModelToolResultPart(call.callId, [text('file contents')])]),
			],
			[READ_FILE_TOOL],
		);

		assert.strictEqual(harness.captured[1].conversationId, 'conv-tool-call', 'tool result reuses by callId');
		assert.ok(!harness.captured[1].message.includes('<visible_chat_transcript>'), 'no transcript re-sent');
		assert.ok(harness.captured[1].message.includes('Tool results:'), 'compact tool-result message');
		assert.ok(harness.captured[1].message.includes('file contents'), 'tool output fed back');
		assert.ok(harness.captured[1].message.includes('read_file'));
		assert.strictEqual(
			harness.wrapper.getCallsFor('deleteConversation').length,
			0,
			'a reused conversation is not deleted',
		);
	});

	test('a full tool round reuses one conversation end to end and deletes nothing', async () => {
		const reply = 'Let me check.\n```vscode-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
		const harness = makeHarness([
			completeTurn('Hello', 'conv-1'),
			completeTurn(reply, 'conv-1'),
			completeTurn('It says hello.', 'conv-1'),
		]);
		harness.wrapper.when('deleteConversation', { data: { deleteConversation: 'deleted' } });

		await harness.run([message(User, [text('hi')])]);
		await harness.run(
			[message(User, [text('hi')]), message(Assistant, [text('Hello')]), message(User, [text('check a.txt')])],
			[READ_FILE_TOOL],
		);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1', 'the tool-call turn appends to conv-1');

		const [call] = callsOf(harness.parts);
		assert.ok(call);

		const askText = textOf(harness.parts);
		await harness.run(
			[
				message(User, [text('hi')]),
				message(Assistant, [text('Hello')]),
				message(User, [text('check a.txt')]),
				message(Assistant, [text(askText), call]),
				message(User, [new vscode.LanguageModelToolResultPart(call.callId, [text('file contents')])]),
			],
			[READ_FILE_TOOL],
		);

		assert.strictEqual(harness.captured[2].conversationId, 'conv-1', 'the tool result stays on conv-1');
		assert.strictEqual(
			harness.wrapper.getCallsFor('deleteConversation').length,
			0,
			'the happy path never deletes a conversation',
		);
	});

	test('continuation rounds start on a new paragraph', async () => {
		const reply = 'Checking.\n```vscode-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```';
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

	test('the opening stateless message carries the directive; reuse turns omit it', async () => {
		const harness = makeHarness([completeTurn('Hello', 'conv-1'), completeTurn('Again', 'conv-1')]);
		await harness.run([message(User, [text('hi')])]);
		assert.ok(
			harness.captured[0].message.startsWith('# Rewst Buddy VS Code Context'),
			'opening message carries the directive',
		);

		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1', 'append reuses the conversation');
		assert.ok(
			!harness.captured[1].message.includes('# Rewst Buddy VS Code Context'),
			'a reused turn does not re-send the directive (the conversation already has it)',
		);
	});

	test('the opening stateless message includes the current Rewst user email metadata', async () => {
		const harness = makeHarness([completeTurn('Hello', 'conv-1'), completeTurn('Again', 'conv-1')]);
		await harness.run([message(User, [text('hi')])]);
		assert.match(harness.captured[0].message, /Current Rewst user email: test-user@example\.com/);
		assert.ok(
			harness.captured[0].message.indexOf('Current Rewst user email') <
				harness.captured[0].message.indexOf('<visible_chat_transcript>'),
			'metadata appears before the visible transcript',
		);

		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);
		assert.ok(
			!harness.captured[1].message.includes('Current Rewst user email'),
			'a reused turn does not re-send opening metadata',
		);
	});

	test('the breadcrumb disambiguates two chats with byte-identical user spines', async () => {
		// Both chats open with the same user text, so the spine hash collides and
		// the second opener overwrites the first under the shared key. The hidden
		// breadcrumb carries each chat's own conversationId, so an append in chat A
		// re-attaches to conv-A, not the colliding conv-B.
		const harness = makeHarness([
			completeTurn('Hi from A', 'conv-A'),
			completeTurn('Hi from B', 'conv-B'),
			completeTurn('A again', 'conv-A'),
		]);

		await harness.run([message(User, [text('hi')])]);
		const chatAAssistant = textOf(harness.parts);
		assert.ok(parseLatestBreadcrumb([message(Assistant, [text(chatAAssistant)])]), 'chat A emitted a breadcrumb');

		// A separate chat, identical opener — overwrites the shared spine key.
		await harness.run([message(User, [text('hi')])]);

		// Chat A appends, replaying chat A's breadcrumb-bearing assistant turn.
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text(chatAAssistant)]),
			message(User, [text('next')]),
		]);
		assert.strictEqual(harness.captured[2].conversationId, 'conv-A', 'breadcrumb re-attaches chat A to conv-A');
	});

	test('a reuse turn the backend cannot follow downgrades to a fresh stateless turn', async () => {
		const harness = makeHarness([
			completeTurn('Hello', 'conv-1'),
			[{ kind: 'error', message: 'conversation not found' }],
			completeTurn('Recovered', 'conv-2'),
		]);
		harness.wrapper.when('deleteConversation', { data: { deleteConversation: 'conv-1' } });

		await harness.run([message(User, [text('hi')])]);
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);

		// First the reuse attempt (conv-1), which errors before output; then the
		// downgraded stateless retry with no conversation id.
		assert.strictEqual(harness.captured.length, 3);
		assert.strictEqual(harness.captured[1].conversationId, 'conv-1', 'reuse attempt first');
		assert.strictEqual(harness.captured[2].conversationId, undefined, 'downgraded stateless retry');
		assert.ok(harness.captured[2].message.includes('<visible_chat_transcript>'), 'retry seeds from the transcript');
		assert.ok(textOf(harness.parts).includes('Recovered'), 'the retry answer streams');
		assert.deepStrictEqual(
			harness.wrapper.getCallsFor('deleteConversation').map(call => call.variables),
			[{ id: 'conv-1' }],
			'the unfollowable conversation is deleted',
		);
	});

	test('a successful append deletes nothing and is not blocked by cleanup', async () => {
		const harness = makeHarness([completeTurn('Hello', 'conv-1'), completeTurn('Again', 'conv-1')]);
		harness.wrapper.when('deleteConversation', () => new Promise<never>(() => {}));

		await harness.run([message(User, [text('hi')])]);
		const result = await Promise.race([
			harness
				.run([message(User, [text('hi')]), message(Assistant, [text('Hello')]), message(User, [text('next')])])
				.then(() => 'resolved'),
			new Promise(resolve => setTimeout(() => resolve('blocked'), 25)),
		]);

		assert.strictEqual(result, 'resolved');
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(harness.wrapper.getCallsFor('deleteConversation').length, 0, 'the happy path never deletes');
	});

	test('custom instructions are prepended to the outgoing message', async () => {
		const harness = makeHarness([completeTurn('ok')], {
			aiConfig: () => ({
				customInstructions: 'answer in haiku',
				conversationType: 'HELP_DOCS',
				showActivity: true,
				maxBuddyToolRounds: MAX_BUDDY_TOOL_ROUNDS,
			}),
		});
		await harness.run([message(User, [text('hi')])]);
		assert.ok(harness.captured[0].message.includes("User's standing instructions: answer in haiku"));
	});

	const activityTurn: ConversationEvent[] = [
		{ kind: 'conversation', conversationId: 'conv-1' },
		{ kind: 'status', label: 'Thinking…' }, // housekeeping (no activity flag) → hidden
		{ kind: 'status', label: 'Summarizing conversation…' }, // housekeeping → hidden
		{ kind: 'status', label: 'Searching documentation…', activity: true },
		{
			kind: 'status',
			label: 'Running Rewst tool: listOrgVariable…',
			activity: true,
			tool: { name: 'listOrgVariable' },
		},
		// back-to-back dup → collapsed
		{
			kind: 'status',
			label: 'Running Rewst tool: listOrgVariable…',
			activity: true,
			tool: { name: 'listOrgVariable' },
		},
		{ kind: 'chunk', text: 'the answer' },
		{ kind: 'complete', content: 'the answer', sources: [], conversationId: 'conv-1' },
	];

	test('shows only substantive activity, hiding thinking/summarizing churn', async () => {
		const harness = makeHarness([activityTurn]);
		await harness.run([message(User, [text('hi')])]);
		const out = textOf(harness.parts);

		assert.ok(!out.includes('Thinking…'), 'housekeeping thinking is not shown');
		assert.ok(!out.includes('Summarizing'), 'housekeeping summarizing is not shown');
		assert.ok(out.includes('> _Searching documentation…_'), 'searches are surfaced');
		assert.ok(out.includes('🔧 **Rewst tool** · `listOrgVariable`'), 'native tool renders card-like');
		assert.strictEqual(
			out.split('🔧 **Rewst tool** · `listOrgVariable`').length - 1,
			1,
			'a repeated tool label collapses to one line',
		);
		assert.ok(out.includes('the answer'), 'the answer still streams');
	});

	test('suppresses activity lines when showActivity is off', async () => {
		const harness = makeHarness([activityTurn], {
			aiConfig: () => ({
				customInstructions: '',
				conversationType: 'HELP_DOCS',
				showActivity: false,
				maxBuddyToolRounds: MAX_BUDDY_TOOL_ROUNDS,
			}),
		});
		await harness.run([message(User, [text('hi')])]);
		const out = textOf(harness.parts);

		assert.ok(!out.includes('Searching documentation') && !out.includes('Running tool'), 'no activity lines');
		assert.ok(out.includes('the answer'), 'the answer still streams');
	});

	const usageTurn: ConversationEvent[] = [
		{ kind: 'conversation', conversationId: 'conv-1' },
		{ kind: 'usage', totalTokens: 60500, maxTokens: 144000, percent: 42 },
		{ kind: 'chunk', text: 'the answer' },
		{ kind: 'complete', content: 'the answer', sources: [], conversationId: 'conv-1' },
	];

	test('records context usage for the status bar without printing it inline', async () => {
		const captured: ContextUsage[] = [];
		const subscription = onDidChangeContextUsage(usage => captured.push(usage));
		try {
			const harness = makeHarness([usageTurn]);
			await harness.run([message(User, [text('hi')])]);

			assert.deepStrictEqual(captured, [
				{ orgId: 'org-1', orgName: undefined, totalTokens: 60500, maxTokens: 144000, percent: 42 },
			]);
			const out = textOf(harness.parts);
			assert.ok(!out.includes('Context'), 'usage is not rendered inline');
			assert.ok(out.includes('the answer'), 'the answer still streams');
		} finally {
			subscription.dispose();
		}
	});

	test('records context usage regardless of the showActivity setting', async () => {
		const captured: ContextUsage[] = [];
		const subscription = onDidChangeContextUsage(usage => captured.push(usage));
		try {
			const harness = makeHarness([usageTurn], {
				aiConfig: () => ({
					customInstructions: '',
					conversationType: 'HELP_DOCS',
					showActivity: false,
					maxBuddyToolRounds: MAX_BUDDY_TOOL_ROUNDS,
				}),
			});
			await harness.run([message(User, [text('hi')])]);

			assert.strictEqual(captured.length, 1, 'usage is recorded even with activity lines off');
			assert.strictEqual(captured[0].percent, 42);
		} finally {
			subscription.dispose();
		}
	});

	test('includes the working directory in context when the full overview is not sent', async () => {
		const harness = makeHarness([completeTurn('ok')], {
			workspaceRoot: () => '/work/dir',
		});
		// No tools passed → permittedNames empty → working-directory line is added.
		await harness.run([message(User, [text('hi')])]);
		assert.ok(harness.captured[0].message.includes('working directory: /work/dir'));
	});
});
