import type { AskOptions, ConversationEvent, Session } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { MAX_CONVERSATION_MESSAGE_CHARS } from '@utils';
import vscode from 'vscode';
import { TOOL_DETAILS_TOOL_NAME } from '../tools/toolCatalog';
import { onDidChangeContextUsage, type ContextUsage } from './contextUsage';
import {
	MAX_BUDDY_TOOL_ROUNDS,
	MAX_NATIVE_REDIRECT_ATTEMPTS,
	MAX_TOOL_DETAILS_ROUNDS,
	normalizeBuddyToolRounds,
	RoboRewstyChatModelProvider,
	truncateArgsLabel,
	type ProviderDeps,
} from './RoboRewstyChatModelProvider';
import { type SeedChunk } from './statelessTranscript';

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
	seeded: { orgId: string; conversationType: string; chunks: SeedChunk[] }[];
	parts: vscode.LanguageModelResponsePart[];
	session: Session;
	wrapper: ReturnType<typeof createMockSession>['wrapper'];
	tokenSource: vscode.CancellationTokenSource;
	run(messages: vscode.LanguageModelChatRequestMessage[], tools?: vscode.LanguageModelChatTool[]): Promise<void>;
}

function makeHarness(turns: ConversationEvent[][], overrides: Partial<ProviderDeps> = {}): Harness {
	const { session, wrapper } = createMockSession({ profile: { org: { id: 'org-1', name: 'Test Org' } } });
	const captured: AskOptions[] = [];
	const seeded: { orgId: string; conversationType: string; chunks: SeedChunk[] }[] = [];
	let turnIndex = 0;
	async function* ask(options: AskOptions): AsyncGenerator<ConversationEvent> {
		captured.push(options);
		const events = turns[Math.min(turnIndex++, turns.length - 1)];
		for (const event of events) yield event;
	}

	const deps: ProviderDeps = {
		ask,
		sessions: () => [session],
		sessionForOrg: async () => session,
		workspaceRoot: () => undefined,
		aiConfig: () => ({
			customInstructions: '',
			conversationType: 'HELP_DOCS',
			showActivity: true,
			maxBuddyToolRounds: MAX_BUDDY_TOOL_ROUNDS,
		}),
		buddyToolSpecs: () => [],
		runBuddyTool: async () => ({ text: '', isError: false }),
		// Most provider tests focus on protocol routing and use scripted backend
		// events. Return deterministic ids so the ask/cleanup contract is exercised.
		seedConversation: async (_session, orgId, conversationType, chunks) => {
			seeded.push({ orgId, conversationType, chunks: chunks.map(chunk => ({ ...chunk })) });
			return `seed-${seeded.length}`;
		},
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
		seeded,
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

function visibleText(parts: vscode.LanguageModelResponsePart[]): string {
	return textOf(parts).trimEnd();
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
		assert.strictEqual(visibleText(harness.parts), 'Hello there', 'answer streams');
		assert.strictEqual(harness.captured[0].conversationId, 'seed-1', 'first turn receives its disposable id');
		assert.strictEqual(harness.captured[0].orgId, 'org-1');
	});

	test('seeds every append turn with the full visible history', async () => {
		const harness = makeHarness([completeTurn('Hello', 'conv-1'), completeTurn('Again', 'conv-1')]);
		await harness.run([message(User, [text('hi')])]);
		assert.strictEqual(harness.captured[0].conversationId, 'seed-1', 'opener receives a disposable id');

		// VS Code replays the emitted text as a consolidated assistant message;
		// the next turn is a pure append onto the same chat.
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);

		assert.strictEqual(harness.captured.length, 2);
		assert.strictEqual(harness.captured[1].conversationId, 'seed-2', 'append receives a new disposable id');
		assert.strictEqual(harness.seeded.length, 2);
		const seeded = harness.seeded[1].chunks.map(chunk => chunk.content).join('\n');
		assert.match(seeded, /hi/);
		assert.match(seeded, /Hello/);
		assert.match(seeded, /next/);
	});

	test('a rewound transcript seeds only the visible branch', async () => {
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
		// Restore Checkpoint rolled the transcript back to after turn 1; the next
		// disposable seed must not leak the rolled-back exchange.
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('a different question')]),
		]);

		assert.strictEqual(harness.captured.length, 3);
		assert.strictEqual(harness.captured[2].conversationId, 'seed-3', 'rewound branch receives a new disposable id');
		const seeded = harness.seeded[2].chunks.map(chunk => chunk.content).join('\n');
		assert.match(seeded, /USER|hi/);
		assert.match(seeded, /a different question/);
		assert.ok(!seeded.includes('Again'), 'rolled-back turn is not replayed');
		assert.ok(
			harness.wrapper.getCallsFor('deleteConversation').some(call => call.variables.id === 'conv-1'),
			'each completed disposable conversation is deleted',
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
		assert.strictEqual(harness.captured[1].conversationId, 'seed-2');
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

	test('advertises Buddy tools from the in-process Buddy path', async () => {
		const harness = makeHarness([completeTurn('hi')], { buddyToolSpecs: () => [BUDDY_GET_SPEC] });
		await harness.run([message(User, [text('what workflows exist?')])]);

		// Sourced from the MCP surface, not options.tools — so it survives VS Code's
		// 128-tool cap even with no tools passed this turn.
		assert.ok(harness.captured[0].message.includes('buddy_workflow_get'), 'buddy tool advertised');
		assert.ok(harness.captured[0].message.includes('Fetch a workflow'), 'buddy description advertised');
	});

	test('advertises no Buddy tools when the Buddy spec provider returns none', async () => {
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
			'seed-2',
			'results use a fresh disposable conversation id',
		);
		assert.strictEqual(harness.seeded.length, 2);
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

	test('preserves every in-process Buddy round in later disposable seeds', async () => {
		const firstReply =
			'First lookup.\n```vscode-tool\n{"tool":"buddy_workflow_get","args":{"workflowId":"a"}}\n```';
		const secondReply =
			'Second lookup.\n```vscode-tool\n{"tool":"buddy_workflow_get","args":{"workflowId":"b"}}\n```';
		const harness = makeHarness([completeTurn(firstReply), completeTurn(secondReply), completeTurn('Done.')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async (_name, args) => ({
				text: `result-${(args as { workflowId: string }).workflowId}`,
				isError: false,
			}),
		});

		await harness.run([message(User, [text('look up both workflows')])]);

		assert.strictEqual(harness.captured.length, 3, 'both tool rounds and the final answer are requested');
		const secondSeed = harness.seeded[1].chunks.map(chunk => chunk.content).join('\n');
		const thirdSeed = harness.seeded[2].chunks.map(chunk => chunk.content).join('\n');
		assert.match(secondSeed, /Requested Buddy tool: buddy_workflow_get/);
		assert.ok(!secondSeed.includes('result-a'), 'the latest result stays in the current ask tail');
		assert.match(thirdSeed, /result-a/, 'the first result is promoted before the next round');
		assert.match(thirdSeed, /workflowId":"b/, 'the second request is retained in the seeded transcript');
		assert.match(harness.captured[2].message, /result-b/, 'the latest result reaches the final ask');
	});

	test('preserves long Buddy request arguments in the next seeded transcript', async () => {
		const args = { blob: 'x'.repeat(500) };
		const reply = `Lookup.\n\`\`\`vscode-tool\n${JSON.stringify({
			tool: 'buddy_workflow_get',
			args,
		})}\n\`\`\``;
		const harness = makeHarness([completeTurn(reply), completeTurn('Done.')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => ({ text: 'result', isError: false }),
		});

		await harness.run([message(User, [text('look up workflow details')])]);

		const nextSeed = harness.seeded[1].chunks.map(chunk => chunk.content).join('\n');
		assert.ok(
			nextSeed.includes(JSON.stringify(args)),
			'seeded Buddy request keeps the complete serialized argument value',
		);
	});

	test('keeps Buddy results when a later native-tool redirect replaces the ask tail', async () => {
		const buddyReply = 'Lookup.\n```vscode-tool\n{"tool":"buddy_workflow_get","args":{"workflowId":"a"}}\n```';
		const nativeAttempt: ConversationEvent[] = [
			{ kind: 'conversation', conversationId: 'conv-native' },
			{
				kind: 'status',
				label: 'Running Rewst tool: listWorkflow…',
				activity: true,
				tool: { name: 'listWorkflow' },
			},
			{ kind: 'complete', content: 'ignored', sources: [], conversationId: 'conv-native' },
		];
		const harness = makeHarness([completeTurn(buddyReply), nativeAttempt, completeTurn('Recovered.')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => ({ text: 'result-a', isError: false }),
		});

		await harness.run([message(User, [text('look up workflow a')])]);

		assert.strictEqual(harness.captured.length, 3, 'the result round, redirect, and recovery are requested');
		const redirectedSeed = harness.seeded[2].chunks.map(chunk => chunk.content).join('\n');
		assert.match(redirectedSeed, /result-a/, 'the redirect does not erase the previous Buddy result');
		assert.match(harness.captured[2].message, /vscode-tool/, 'the replacement tail is the redirect correction');
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
		assert.strictEqual(
			harness.captured[1].conversationId,
			'seed-2',
			'correction receives a disposable conversation id',
		);
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
			!/previous server-side Rewst tool status was an error/i.test(harness.captured[1].message),
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

	test('carries the native tool args into the correction so the Buddy call reuses them', async () => {
		const nativeAttempt: ConversationEvent[] = [
			{ kind: 'conversation', conversationId: 'conv-1' },
			{
				kind: 'status',
				label: 'Running Rewst tool: getWorkflow…',
				activity: true,
				tool: { name: 'getWorkflow', args: '{"workflowId":"w1","orgId":"org-1"}' },
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
		const harness = makeHarness(
			[nativeAttempt, completeTurn(buddyReply, 'conv-1'), completeTurn('Deploy.', 'conv-1')],
			{
				buddyToolSpecs: () => [BUDDY_GET_SPEC],
				runBuddyTool: async () => ({ text: 'name: Deploy', isError: false }),
			},
		);

		await harness.run([message(User, [text('look up workflow w1')])]);

		const correction = harness.captured[1].message;
		assert.ok(
			correction.includes('{"workflowId":"w1","orgId":"org-1"}'),
			'correction carries the resolved native args',
		);
		assert.ok(!/<[^>\n]+>/.test(correction), 'carried args do not introduce XML-like tags');
	});

	test('redirects a server-side Rewst tool even when VS Code already supplied every Buddy tool natively', async () => {
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
		// The corrected turn requests the natively-supplied Buddy tool via a fenced block.
		const buddyReply = '```vscode-tool\n{"tool": "buddy_workflow_get", "args": {"workflowId": "w1"}}\n```';
		const harness = makeHarness([nativeAttempt, completeTurn(buddyReply, 'conv-1')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
		});
		// VS Code passes buddy_workflow_get natively (under the 128-tool cap), so the
		// in-process Buddy spec is filtered out — yet the local path still exists.
		const buddyNativeTool: vscode.LanguageModelChatTool = {
			name: 'buddy_workflow_get',
			description: 'Fetch a workflow',
			inputSchema: { type: 'object' },
		};

		await harness.run([message(User, [text('look up workflow w1')])], [buddyNativeTool]);

		assert.strictEqual(
			harness.captured.length,
			2,
			'a server-side Rewst tool is still redirected when the Buddy tool is native',
		);
		assert.ok(
			harness.captured[1].message.includes('buddy_workflow_get'),
			'correction names the natively-supplied Buddy tool',
		);
		const calls = callsOf(harness.parts);
		assert.strictEqual(calls.length, 1, 'the redirected fenced request becomes a native VS Code tool call');
		assert.strictEqual(calls[0].name, 'buddy_workflow_get');
		const out = textOf(harness.parts);
		assert.ok(!out.includes('🔧 **Rewst tool** · `listWorkflow`'), 'intercepted native tool card is not rendered');
		assert.ok(
			!out.includes('native result that should not stream'),
			'abandoned native stream output is not rendered',
		);
	});

	test('redirects any native Rewst tool unconditionally, even when no Buddy tools are configured', async () => {
		// Previously the redirect was gated on buddyNames.size > 0 — this test
		// documents that the unconditional redirect fires even with no buddy tools.
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
		const harness = makeHarness([nativeAttempt, completeTurn('Redirected answer.', 'conv-1')]); // buddyToolSpecs defaults to []

		await harness.run([message(User, [text('look up workflow w1')])]);

		assert.strictEqual(harness.captured.length, 2, 'a correction turn is sent even without Buddy tools');
		assert.ok(harness.captured[1].message.includes('vscode-tool'), 'correction names the fenced protocol');
		const out = textOf(harness.parts);
		assert.ok(!out.includes('native result that should not stream'), 'abandoned native stream is not rendered');
		assert.ok(out.includes('Redirected answer.'), 'the corrected turn answer streams');
	});

	test('redirects a native call to a VS Code editor tool with an editor-specific correction', async () => {
		// manage_todo_list is in EDITOR_ONLY_REMINDER_TOOLS; when it is also in
		// vscodeNames (passed via options.tools), editorToolNames picks it up and
		// buildNativeToEditorCorrection is used instead of buildNativeToBuddyCorrection.
		const MANAGE_TODO_TOOL: vscode.LanguageModelChatTool = {
			name: 'manage_todo_list',
			description: 'manage a todo list',
			inputSchema: { type: 'object' },
		};
		const nativeAttempt: ConversationEvent[] = [
			{ kind: 'conversation', conversationId: 'conv-1' },
			{
				kind: 'status',
				label: 'Running Rewst tool: manage_todo_list…',
				activity: true,
				tool: { name: 'manage_todo_list', args: '{"todoList":[]}' },
			},
			{ kind: 'chunk', text: 'native result that should not stream' },
			{
				kind: 'complete',
				content: 'native result that should not stream',
				sources: [],
				conversationId: 'conv-1',
			},
		];
		const harness = makeHarness([nativeAttempt, completeTurn('Used vscode-tool block.', 'conv-1')]);

		await harness.run([message(User, [text('update the todo list')])], [MANAGE_TODO_TOOL]);

		assert.strictEqual(harness.captured.length, 2, 'a correction turn is sent for the editor tool call');
		const correction = harness.captured[1].message;
		// Editor correction tells the model to use a vscode-tool fenced block, not a buddy tool.
		assert.ok(correction.includes('vscode-tool'), 'correction names the fenced block protocol');
		assert.ok(correction.includes('manage_todo_list'), 'correction names the intercepted tool');
		assert.ok(correction.includes('VS Code editor tool'), 'correction identifies it as an editor tool');
		assert.ok(!correction.includes('buddy_'), 'editor correction does not mention buddy tools');
		const out = textOf(harness.parts);
		assert.ok(!out.includes('native result that should not stream'), 'abandoned native stream is not rendered');
		assert.ok(out.includes('Used vscode-tool block.'), 'the corrected turn answer streams');
	});

	test('redirects a native call to an unknown tool using the buddy correction fallback', async () => {
		// A tool that is neither in EDITOR_ONLY_REMINDER_TOOLS nor a buddy tool
		// (e.g. a hallucinated Rewst action name) still gets redirected, and the
		// correction falls back to buildNativeToBuddyCorrection.
		const nativeAttempt: ConversationEvent[] = [
			{ kind: 'conversation', conversationId: 'conv-1' },
			{
				kind: 'status',
				label: 'Running Rewst tool: someRewstAction…',
				activity: true,
				tool: { name: 'someRewstAction' },
			},
			{ kind: 'chunk', text: 'native result that should not stream' },
			{
				kind: 'complete',
				content: 'native result that should not stream',
				sources: [],
				conversationId: 'conv-1',
			},
		];
		const harness = makeHarness([nativeAttempt, completeTurn('Buddy answer.', 'conv-1')], {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
		});

		await harness.run([message(User, [text('do something')])]);

		assert.strictEqual(harness.captured.length, 2, 'unknown native tool is still redirected');
		const correction = harness.captured[1].message;
		assert.ok(correction.includes('vscode-tool'), 'correction names the fenced protocol');
		assert.ok(correction.includes('local tool protocol'), 'buddy correction wording is used');
		assert.ok(correction.includes('buddy_workflow_get'), 'correction lists available buddy tools');
		const out = textOf(harness.parts);
		assert.ok(!out.includes('native result that should not stream'), 'abandoned native stream is not rendered');
		assert.ok(out.includes('Buddy answer.'), 'the corrected turn answer streams');
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

	test('stops only after exhausting the escalating redirect ceiling', async () => {
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
		// MAX_NATIVE_REDIRECT_ATTEMPTS corrections are attempted (each triggering one
		// more backend turn), and the native tool is requested again on that final
		// turn too — only then does the loop give up.
		const turns = Array.from({ length: MAX_NATIVE_REDIRECT_ATTEMPTS + 1 }, () => nativeAttempt);
		turns.push(completeTurn('unreachable', 'conv-1'));
		const harness = makeHarness(turns, {
			buddyToolSpecs: () => [BUDDY_GET_SPEC],
			runBuddyTool: async () => {
				buddyRan = true;
				return { text: '', isError: false };
			},
		});

		await harness.run([message(User, [text('look up workflow w1')])]);

		assert.strictEqual(
			harness.captured.length,
			MAX_NATIVE_REDIRECT_ATTEMPTS + 1,
			`${MAX_NATIVE_REDIRECT_ATTEMPTS} corrections are attempted (${MAX_NATIVE_REDIRECT_ATTEMPTS + 1} backend turns total), then the loop stops`,
		);
		assert.strictEqual(buddyRan, false, 'no local Buddy tool runs without a fenced Buddy request');
		assert.strictEqual(callsOf(harness.parts).length, 0, 'no VS Code tool call is emitted for native activity');
		const out = visibleText(harness.parts);
		assert.ok(out.includes('Stopped after a server-side Rewst tool was requested again'), 'stop note is visible');
		assert.ok(!out.includes('unreachable'), 'no turn beyond the ceiling is started');
		const lastCorrection = harness.captured[harness.captured.length - 1];
		assert.ok(
			lastCorrection.message.includes(
				`attempt ${MAX_NATIVE_REDIRECT_ATTEMPTS} of ${MAX_NATIVE_REDIRECT_ATTEMPTS}`,
			),
			`expected the final correction to name attempt ${MAX_NATIVE_REDIRECT_ATTEMPTS}, got: ${lastCorrection.message}`,
		);
	});

	test('a redirect that succeeds on a later attempt reaches a final answer instead of stopping', async () => {
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
		// Three native-tool attempts (not just one) before the backend finally
		// follows the correction and answers — this only succeeds if the ceiling
		// is greater than 1.
		const harness = makeHarness(
			[nativeAttempt, nativeAttempt, nativeAttempt, completeTurn('Recovered on a later attempt.', 'conv-1')],
			{ buddyToolSpecs: () => [BUDDY_GET_SPEC] },
		);

		await harness.run([message(User, [text('look up workflow w1')])]);

		assert.strictEqual(harness.captured.length, 4, 'three corrections were attempted before the answer');
		const out = visibleText(harness.parts);
		assert.ok(out.includes('Recovered on a later attempt.'), 'the final answer streams after recovering');
		assert.ok(
			!out.includes('Stopped after a server-side Rewst tool was requested again'),
			'the loop does not give up before reaching the ceiling',
		);
	});

	test('a downgrade after a native-tool redirect resets the redirect budget for the fresh attempt', async () => {
		// One redirect happens on the reuse turn; that turn then errors and downgrades
		// to a fresh stateless attempt. The native tool in the fresh attempt is the
		// first of that attempt and must redirect again, not hit the "requested again"
		// stop left over from the abandoned reuse turn.
		const nativeStatus: ConversationEvent[] = [
			{
				kind: 'status',
				label: 'Running Rewst tool: listWorkflow…',
				activity: true,
				tool: { name: 'listWorkflow' },
			},
		];
		const harness = makeHarness(
			[
				completeTurn('Hello', 'conv-1'), // run 1: establishes conv-1 for reuse
				nativeStatus, // run 2 reuse attempt: native tool → redirect #1
				[{ kind: 'error', message: 'conversation not found' }], // correction turn errors → downgrade
				nativeStatus, // fresh stateless attempt: native tool again
				completeTurn('Recovered via Buddy.'), // stateless correction turn answers
			],
			{ buddyToolSpecs: () => [BUDDY_GET_SPEC] },
		);
		harness.wrapper.when('deleteConversation', { data: { deleteConversation: 'conv-1' } });

		await harness.run([message(User, [text('hi')])]);
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);

		const out = visibleText(harness.parts);
		assert.ok(
			!out.includes('Stopped after a server-side Rewst tool was requested again'),
			'the fresh stateless attempt is not aborted by a stale redirect flag',
		);
		assert.ok(out.includes('Recovered via Buddy.'), 'the downgraded attempt redirects again and reaches an answer');
		const lastSent = harness.captured[harness.captured.length - 1];
		assert.ok(
			lastSent.message.includes('local tool protocol'),
			'a fresh correction was sent for the stateless native tool',
		);
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
		// Disposable turn: runs the buddy tool, then the backend loses the follow-up conversation.
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

	test('a tool result seeds visible history with a compact continuation message', async () => {
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
		// we streamed (split parts, different narration). The preserved callId is
		// still serialized into the fresh seed, and the results are fed back compactly.
		await harness.run(
			[
				...ask1,
				message(Assistant, [text('completely'), text(' different narration'), call]),
				message(User, [new vscode.LanguageModelToolResultPart(call.callId, [text('file contents')])]),
			],
			[READ_FILE_TOOL],
		);

		assert.strictEqual(harness.captured[1].conversationId, 'seed-2', 'tool result receives a fresh disposable id');
		assert.strictEqual(harness.seeded.length, 2);
		assert.ok(harness.seeded[1].chunks.some(chunk => chunk.content.includes('Editor tool result: read_file')));
		assert.ok(
			harness.seeded[1].chunks.some(chunk => chunk.content.includes('file contents')),
			'tool output is seeded',
		);
		assert.ok(harness.seeded[1].chunks.some(chunk => chunk.content.includes('read_file')));
		assert.strictEqual(
			harness.wrapper.getCallsFor('deleteConversation').length,
			2,
			'each disposable conversation is deleted',
		);
	});

	test('a full tool round uses disposable conversations end to end', async () => {
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
		assert.strictEqual(harness.captured[1].conversationId, 'seed-2', 'the tool-call turn receives a fresh id');

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

		assert.strictEqual(harness.captured[2].conversationId, 'seed-3', 'the tool result receives a fresh id');
		assert.strictEqual(
			harness.wrapper.getCallsFor('deleteConversation').length,
			3,
			'the happy path deletes each disposable conversation',
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

	test('each disposable ask carries the directive', async () => {
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
		assert.ok(
			harness.captured[1].message.includes('# Rewst Buddy VS Code Context'),
			'a fresh disposable turn carries the directive',
		);
	});

	test('each disposable ask includes the current Rewst user email metadata', async () => {
		const harness = makeHarness([completeTurn('Hello', 'conv-1'), completeTurn('Again', 'conv-1')]);
		await harness.run([message(User, [text('hi')])]);
		assert.match(harness.captured[0].message, /Current Rewst user email: test-user@example\.com/);

		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);
		assert.ok(
			harness.captured[1].message.includes('Current Rewst user email'),
			'a fresh turn carries session metadata',
		);
	});

	test('byte-identical chats seed independently without hidden backend state', async () => {
		const harness = makeHarness([
			completeTurn('Hi from A', 'conv-A'),
			completeTurn('Hi from B', 'conv-B'),
			completeTurn('A again', 'conv-A'),
		]);

		await harness.run([message(User, [text('hi')])]);
		const chatAAssistant = textOf(harness.parts);
		assert.ok(chatAAssistant.length > 0, 'answers are visible text only');

		// A separate chat, identical opener — overwrites the shared spine key.
		await harness.run([message(User, [text('hi')])]);

		// Chat A appends; the fresh seed is based only on the visible replay.
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text(chatAAssistant)]),
			message(User, [text('next')]),
		]);
		assert.strictEqual(harness.captured[2].conversationId, 'seed-3', 'the append receives a disposable id');
		assert.strictEqual(harness.seeded.length, 3);
		assert.match(harness.seeded[2].chunks.map(chunk => chunk.content).join('\n'), /next/);
	});

	test('an ask error retries once with another disposable seed', async () => {
		const harness = makeHarness([
			completeTurn('Hello', 'conv-1'),
			[{ kind: 'error', message: 'conversation not found' }],
			completeTurn('Recovered', 'conv-2'),
		]);
		harness.wrapper.when('deleteConversation', variables => ({ data: { deleteConversation: variables.id } }));

		await harness.run([message(User, [text('hi')])]);
		await harness.run([
			message(User, [text('hi')]),
			message(Assistant, [text('Hello')]),
			message(User, [text('next')]),
		]);

		// The first disposable ask errors before output; the provider retries once.
		assert.strictEqual(harness.captured.length, 3);
		assert.strictEqual(harness.captured[1].conversationId, 'seed-2', 'failed ask receives a disposable id');
		assert.strictEqual(harness.captured[2].conversationId, 'seed-3', 'retry receives a new disposable id');
		assert.deepStrictEqual(
			harness.captured.map(call => call.conversationId),
			['seed-1', 'seed-2', 'seed-3'],
			'each ask receives the id returned by its seed',
		);
		assert.strictEqual(harness.seeded.length, 3, 'each ask receives a role-aware seed');
		assert.match(harness.seeded[2].chunks.map(chunk => chunk.content).join('\n'), /next/);
		assert.ok(textOf(harness.parts).includes('Recovered'), 'the retry answer streams');
		assert.ok(
			harness.wrapper.getCallsFor('deleteConversation').some(call => call.variables.id === 'seed-2'),
			'failed ask is cleaned up before any conversation event arrives',
		);
	});

	test('disposable cleanup does not block a successful append', async () => {
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
		assert.strictEqual(
			harness.wrapper.getCallsFor('deleteConversation').length,
			2,
			'both disposable asks are deleted',
		);
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

	test('the configured conversation type starts the backend conversation in workflow-diagnosis mode', async () => {
		const harness = makeHarness([completeTurn('ok')], {
			aiConfig: () => ({
				customInstructions: '',
				conversationType: 'WORKFLOW_DIAGNOSIS',
				showActivity: true,
				maxBuddyToolRounds: MAX_BUDDY_TOOL_ROUNDS,
			}),
		});
		await harness.run([message(User, [text('why did my workflow fail?')])]);
		assert.strictEqual(harness.captured[0].conversationType, 'WORKFLOW_DIAGNOSIS');
	});

	// Activity turn for label-filtering tests. No `tool` field on the Rewst-tool
	// status events — adding one would trigger the unconditional native-tool
	// redirect and consume extra turns, breaking tests that only care about
	// activity-label visibility. Card rendering for native tools is covered by
	// the redirect tests above (which assert on the intercepted card).
	const activityTurn: ConversationEvent[] = [
		{ kind: 'conversation', conversationId: 'conv-1' },
		{ kind: 'status', label: 'Thinking…' }, // housekeeping (no activity flag) → hidden
		{ kind: 'status', label: 'Summarizing conversation…' }, // housekeeping → hidden
		{ kind: 'status', label: 'Searching documentation…', activity: true },
		{ kind: 'status', label: 'Running Rewst tool: listOrgVariable…', activity: true },
		// back-to-back dup → collapsed
		{ kind: 'status', label: 'Running Rewst tool: listOrgVariable…', activity: true },
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
		// Without a `tool` field the status renders as a plain italic activity line.
		assert.ok(out.includes('Running Rewst tool: listOrgVariable'), 'native tool activity is surfaced');
		assert.strictEqual(
			out.split('Running Rewst tool: listOrgVariable').length - 1,
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

	suite('message length budget (#189)', () => {
		// One spec sized like the real registry's heavier tools (full description +
		// JSON args schema), so a realistic tool count reproduces the overflow that
		// made the backend reject every turn with its 60000-character limit.
		function fatSpec(name: string) {
			return {
				name,
				description: `Does ${name} thoroughly. ${'Detailed steering prose. '.repeat(40)}`,
				args: JSON.stringify({
					type: 'object',
					properties: Object.fromEntries(
						Array.from({ length: 12 }, (_, i) => [
							`field_${i}`,
							{ type: 'string', description: 'a'.repeat(60) },
						]),
					),
				}),
			};
		}

		const manyBuddySpecs = Array.from({ length: 74 }, (_, i) => fatSpec(`buddy_tool_${i}`));

		test('keeps the first turn under the backend message limit with a full tool registry', async () => {
			const harness = makeHarness([completeTurn('ok')], { buddyToolSpecs: () => manyBuddySpecs });
			await harness.run([message(User, [text('test')])]);

			const sent = harness.captured[0].message;
			assert.ok(
				sent.length <= MAX_CONVERSATION_MESSAGE_CHARS,
				`message was ${sent.length} chars, over the backend limit of ${MAX_CONVERSATION_MESSAGE_CHARS}`,
			);
		});

		test('advertises overflow tools as a catalog plus the details lookup', async () => {
			const harness = makeHarness([completeTurn('ok')], { buddyToolSpecs: () => manyBuddySpecs });
			await harness.run([message(User, [text('test')])]);

			const sent = harness.captured[0].message;
			assert.ok(sent.includes('Tool catalog (summary only):'), 'a catalog section is sent');
			assert.ok(sent.includes(TOOL_DETAILS_TOOL_NAME), 'the catalog expansion tool is advertised');
			for (const spec of manyBuddySpecs) {
				assert.ok(sent.includes(spec.name), `${spec.name} is still discoverable`);
			}
		});

		test('answers a details request locally with the full schema of the named tools', async () => {
			const target = manyBuddySpecs[70];
			const harness = makeHarness(
				[
					completeTurn(
						`\`\`\`vscode-tool\n{"tool": "${TOOL_DETAILS_TOOL_NAME}", "args": {"tools": ["${target.name}"]}}\n\`\`\``,
					),
					completeTurn('done'),
				],
				{
					buddyToolSpecs: () => manyBuddySpecs,
					runBuddyTool: async () => {
						assert.fail('the details lookup must not reach the capability registry');
					},
				},
			);
			await harness.run([message(User, [text('test')])]);

			assert.strictEqual(harness.captured.length, 2, 'the lookup feeds a follow-up turn');
			const results = harness.captured[1].message;
			assert.ok(results.includes(`### ${target.name}`));
			assert.ok(results.includes(target.args), 'the exact args schema is fed back');
		});

		test('sends the full manifest on every disposable conversation', async () => {
			const harness = makeHarness([completeTurn('first'), completeTurn('second')], {
				buddyToolSpecs: () => manyBuddySpecs,
			});
			const first = [message(User, [text('one')])];
			await harness.run(first);
			// Same chat, appended turn → a new conversation is seeded.
			await harness.run([
				...first,
				message(Assistant, [text(visibleText(harness.parts))]),
				message(User, [text('two')]),
			]);

			assert.strictEqual(harness.captured.length, 2);
			const [opening, followUp] = harness.captured.map(call => call.message);
			assert.ok(opening.includes('Tool catalog (summary only):'), 'the opening turn carries the manifest');
			assert.ok(followUp.includes('Tool catalog (summary only):'), 'the manifest is re-sent for the fresh seed');
			assert.ok(followUp.includes('buddy_tool_0'), 'available tool names stay accurate');
			assert.ok(followUp.includes('# Rewst Buddy VS Code Context'), 'the safety directive remains present');
		});

		test('re-sends the full manifest on a disposable retry after an ask error', async () => {
			const harness = makeHarness(
				[
					completeTurn('first'),
					// The second disposable turn fails before any output → retry.
					[{ kind: 'error', message: 'conversation not found' }],
					completeTurn('second'),
				],
				{ buddyToolSpecs: () => manyBuddySpecs },
			);
			const first = [message(User, [text('one')])];
			await harness.run(first);
			await harness.run([
				...first,
				message(Assistant, [text(visibleText(harness.parts))]),
				message(User, [text('two')]),
			]);

			assert.strictEqual(harness.captured.length, 3, 'the failed reuse turn is retried statelessly');
			assert.ok(harness.captured[1].message.includes('Tool catalog (summary only):'));
			assert.ok(
				harness.captured[2].message.includes('Tool catalog (summary only):'),
				'the retry gets the full manifest again',
			);
			assert.strictEqual(
				harness.captured[2].conversationId,
				'seed-3',
				'the retry receives a fresh disposable id',
			);
		});

		test('a tool-result turn seeds the result and sends the current manifest', async () => {
			const harness = makeHarness(
				[
					// Round 1: the model asks for a VS Code editor tool.
					completeTurn('```vscode-tool\n{"tool": "read_file", "args": {"path": "a.txt"}}\n```'),
					completeTurn('answer'),
					completeTurn('follow-up answer'),
				],
				{ buddyToolSpecs: () => manyBuddySpecs },
			);
			const tools = [{ name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object' } }];
			const first = [message(User, [text('read a.txt')])];
			await harness.run(first, tools);

			const call = harness.parts.find(
				(part): part is vscode.LanguageModelToolCallPart => part instanceof vscode.LanguageModelToolCallPart,
			);
			assert.ok(call, 'an editor tool call was emitted');
			// VS Code replays the result; the fresh turn carries results plus the
			// current manifest and safety directive.
			await harness.run(
				[
					...first,
					message(Assistant, [call]),
					message(User, [new vscode.LanguageModelToolResultPart(call.callId, [text('file body')])]),
				],
				tools,
			);

			assert.strictEqual(harness.captured.length, 2);
			const resultsTurn = harness.captured[1].message;
			assert.ok(harness.seeded[1].chunks.some(chunk => chunk.content.includes('Editor tool result: read_file')));
			assert.ok(harness.seeded[1].chunks.some(chunk => chunk.content.includes('file body')));
			assert.ok(resultsTurn.includes('Tool catalog (summary only):'), 'fresh results turns carry the manifest');
		});

		test('re-sends the full manifest when the available tool set changed', async () => {
			let specs = manyBuddySpecs;
			const harness = makeHarness([completeTurn('first'), completeTurn('second')], {
				buddyToolSpecs: () => specs,
			});
			const first = [message(User, [text('one')])];
			await harness.run(first);
			specs = [...manyBuddySpecs, fatSpec('buddy_newly_enabled')];
			await harness.run([
				...first,
				message(Assistant, [text(visibleText(harness.parts))]),
				message(User, [text('two')]),
			]);

			const followUp = harness.captured[1].message;
			assert.ok(
				followUp.includes('Tool catalog (summary only):'),
				'the changed tool set is re-advertised in full',
			);
			assert.ok(followUp.includes('buddy_newly_enabled'), 'the new tool is advertised');
		});

		test('re-sends the full manifest when a tool keeps its name but changes its args schema', async () => {
			// Names alone would look unchanged, so the follow-up would send the refresher
			// while the conversation still held the old schema.
			const original = fatSpec('buddy_tool_0');
			let specs = [original, ...manyBuddySpecs.slice(1)];
			const harness = makeHarness([completeTurn('first'), completeTurn('second')], {
				buddyToolSpecs: () => specs,
			});
			const first = [message(User, [text('one')])];
			await harness.run(first);

			const changed = { ...original, args: JSON.stringify({ type: 'object', properties: { renamed: {} } }) };
			specs = [changed, ...manyBuddySpecs.slice(1)];
			await harness.run([
				...first,
				message(Assistant, [text(visibleText(harness.parts))]),
				message(User, [text('two')]),
			]);

			const followUp = harness.captured[1].message;
			assert.ok(followUp.includes('Tool catalog (summary only):'), 'the changed schema is re-advertised in full');
			assert.ok(followUp.includes('renamed'), 'the new schema reaches the backend');
		});

		test('advertises a Buddy tool once when VS Code also passes it under its MCP name', async () => {
			// With Rewst Buddy's /mcp bridge configured as a chat MCP server, VS Code
			// hands our own tools back as mcp_<server>_buddy_x — the same operation we
			// already run in-process, so it must not be advertised twice.
			const harness = makeHarness([completeTurn('ok')], {
				buddyToolSpecs: () => [fatSpec('buddy_workflow_get'), fatSpec('buddy_list_orgs')],
			});
			await harness.run(
				[message(User, [text('hi')])],
				[
					{
						name: 'mcp_rewst-buddy_buddy_workflow_get',
						description: 'duplicate of the in-process tool',
						inputSchema: { type: 'object' },
					},
					{ name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object' } },
				],
			);

			const sent = harness.captured[0].message;
			assert.ok(!sent.includes('mcp_rewst-buddy_buddy_workflow_get'), 'the prefixed duplicate is not advertised');
			assert.ok(sent.includes('buddy_workflow_get'), 'the in-process tool is advertised');
			assert.ok(sent.includes('read_file'), 'unrelated editor tools are untouched');
		});

		test('keeps editor tools in full detail when the registry is huge', async () => {
			const editorTools = Array.from({ length: 50 }, (_, i) => ({
				name: `editor_tool_${i}`,
				description: `Editor tool ${i}. ${'Copilot steering prose. '.repeat(30)}`,
				inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
			}));
			const harness = makeHarness([completeTurn('ok')], { buddyToolSpecs: () => manyBuddySpecs });
			await harness.run([message(User, [text('hi')])], editorTools);

			const sent = harness.captured[0].message;
			assert.ok(sent.length <= MAX_CONVERSATION_MESSAGE_CHARS, `message was ${sent.length} chars`);
			assert.ok(
				sent.includes('editor_tool_0 — args: {"type":"object"'),
				'the first editor tools keep their exact args schema',
			);
			for (const tool of editorTools) assert.ok(sent.includes(tool.name), `${tool.name} is discoverable`);
			for (const spec of manyBuddySpecs) assert.ok(sent.includes(spec.name), `${spec.name} is discoverable`);
		});

		test('the protocol example names a real tool, not the details lookup with no args', async () => {
			const harness = makeHarness([completeTurn('ok')], { buddyToolSpecs: () => manyBuddySpecs });
			await harness.run(
				[message(User, [text('hi')])],
				[{ name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object' } }],
			);

			const sent = harness.captured[0].message;
			assert.ok(
				!sent.includes(`{"tool": "${TOOL_DETAILS_TOOL_NAME}", "args": {}}`),
				'the example is not a details call with no names',
			);
			assert.ok(sent.includes('{"tool": "read_file"'), 'the example uses a real tool');
		});

		test('a catalog lookup does not spend a Rewst tool round', async () => {
			// maxBuddyToolRounds is the budget for real Rewst work; reading the manifest
			// must not consume it, or a couple of lookups would starve the task.
			const harness = makeHarness(
				[
					completeTurn(
						`\`\`\`vscode-tool\n{"tool": "${TOOL_DETAILS_TOOL_NAME}", "args": {"tools": ["buddy_tool_5"]}}\n\`\`\``,
					),
					completeTurn(
						`\`\`\`vscode-tool\n{"tool": "${TOOL_DETAILS_TOOL_NAME}", "args": {"tools": ["buddy_tool_6"]}}\n\`\`\``,
					),
					completeTurn('```vscode-tool\n{"tool": "buddy_tool_5", "args": {}}\n```'),
					completeTurn('done'),
				],
				{
					buddyToolSpecs: () => manyBuddySpecs,
					aiConfig: () => ({
						customInstructions: '',
						conversationType: 'HELP_DOCS',
						showActivity: true,
						// One Rewst round only: the two lookups must still get through.
						maxBuddyToolRounds: 1,
					}),
					runBuddyTool: async () => ({ text: 'real tool output', isError: false }),
				},
			);
			await harness.run([message(User, [text('use tool 5')])]);

			assert.strictEqual(harness.captured.length, 4, 'both lookups and the real call ran');
			assert.ok(!visibleText(harness.parts).includes('Stopped after 1 Rewst tool call'), 'the cap did not trip');
			assert.ok(visibleText(harness.parts).includes('done'), 'the turn reached its answer');
		});

		test('charges one round for a reply mixing a catalog lookup with a real tool call', async () => {
			const harness = makeHarness(
				[
					completeTurn(
						`\`\`\`vscode-tool\n{"tool": "${TOOL_DETAILS_TOOL_NAME}", "args": {"tools": ["buddy_tool_5"]}}\n\`\`\`\n` +
							'```vscode-tool\n{"tool": "buddy_tool_5", "args": {"orgId": "org-1"}}\n```',
					),
					completeTurn('done'),
				],
				{
					buddyToolSpecs: () => manyBuddySpecs,
					aiConfig: () => ({
						customInstructions: '',
						conversationType: 'HELP_DOCS',
						showActivity: true,
						// The mixed reply may spend the one Rewst round, and no more.
						maxBuddyToolRounds: 1,
					}),
					runBuddyTool: async () => ({ text: 'REAL-TOOL-OUTPUT', isError: false }),
				},
			);
			await harness.run([message(User, [text('use tool 5')])]);

			assert.strictEqual(harness.captured.length, 2, 'the mixed round ran and fed results back');
			const results = harness.captured[1].message;
			assert.ok(results.includes(manyBuddySpecs[5].args), 'the catalog details are fed back');
			assert.ok(results.includes('REAL-TOOL-OUTPUT'), 'the real tool output is fed back');
			assert.ok(visibleText(harness.parts).includes('done'), 'the response completes');
			assert.ok(
				!visibleText(harness.parts).includes('Stopped after 1 Rewst tool call'),
				'the single charged round was enough',
			);
		});

		test('stops a response that only ever asks for tool details', async () => {
			const lookup = completeTurn(
				`\`\`\`vscode-tool\n{"tool": "${TOOL_DETAILS_TOOL_NAME}", "args": {"tools": ["buddy_tool_5"]}}\n\`\`\``,
			);
			const harness = makeHarness([lookup], { buddyToolSpecs: () => manyBuddySpecs });
			await harness.run([message(User, [text('hi')])]);

			assert.ok(
				visibleText(harness.parts).includes('repeated tool-detail lookups'),
				'the details-only loop is bounded',
			);
			assert.ok(harness.captured.length <= MAX_TOOL_DETAILS_ROUNDS + 1, 'it stops at its own ceiling');
		});

		test('keeps a huge visible transcript within the seed budget', async () => {
			const harness = makeHarness([completeTurn('ok')], { buddyToolSpecs: () => manyBuddySpecs });
			await harness.run([
				message(User, [text('a'.repeat(40_000))]),
				message(Assistant, [text('b'.repeat(40_000))]),
				message(User, [text('c'.repeat(40_000))]),
			]);

			const seeded = harness.seeded[0].chunks;
			assert.ok(seeded.reduce((sum, chunk) => sum + chunk.content.length, 0) <= 400_000);
			assert.ok(
				seeded.some(chunk => chunk.content.includes('c'.repeat(1_000))),
				'the latest user turn survives the trim',
			);
		});

		test('keeps the user request in the message when standing instructions are oversized', async () => {
			// customInstructions is user-authored and unbounded, and it sits AHEAD of the
			// question — uncapped, the transport clamp would drop the request instead.
			const oversizedConfig = () => ({
				customInstructions: 'x'.repeat(80_000),
				conversationType: 'HELP_DOCS',
				showActivity: true,
				maxBuddyToolRounds: MAX_BUDDY_TOOL_ROUNDS,
			});
			const harness = makeHarness([completeTurn('first'), completeTurn('second')], {
				buddyToolSpecs: () => manyBuddySpecs,
				aiConfig: oversizedConfig,
			});
			const first = [message(User, [text('WHAT-I-ACTUALLY-ASKED')])];
			await harness.run(first);
			// And again on a fresh seed, which assembles the same bounded prompt shape.
			await harness.run([
				...first,
				message(Assistant, [text(visibleText(harness.parts))]),
				message(User, [text('SECOND-QUESTION')]),
			]);

			const [stateless, fresh] = harness.captured.map(call => call.message);
			assert.ok(
				stateless.length <= MAX_CONVERSATION_MESSAGE_CHARS,
				`stateless turn was ${stateless.length} chars`,
			);
			assert.ok(fresh.length <= MAX_CONVERSATION_MESSAGE_CHARS, `fresh turn was ${fresh.length} chars`);
			assert.ok(harness.seeded[0].chunks.some(chunk => chunk.content.includes('WHAT-I-ACTUALLY-ASKED')));
			assert.ok(
				harness.seeded[1].chunks.some(chunk => chunk.content.includes('SECOND-QUESTION')),
				'the fresh seed still carries the request',
			);
		});

		test('keeps a huge buddy tool result under the backend message limit', async () => {
			const harness = makeHarness(
				[completeTurn('```vscode-tool\n{"tool": "buddy_tool_0", "args": {}}\n```'), completeTurn('done')],
				{
					buddyToolSpecs: () => manyBuddySpecs,
					runBuddyTool: async () => ({ text: 'x'.repeat(200_000), isError: false }),
				},
			);
			await harness.run([message(User, [text('test')])]);

			assert.strictEqual(harness.captured.length, 2);
			assert.ok(
				harness.captured[1].message.length <= MAX_CONVERSATION_MESSAGE_CHARS,
				`results message was ${harness.captured[1].message.length} chars`,
			);
		});
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
