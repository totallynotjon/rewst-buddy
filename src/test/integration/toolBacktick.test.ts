import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { askRewstAi, Session } from '@sessions';
import { clearCachedSession, getTestSession, getTestToken, hasTestToken, initTestEnvironment } from '@test';
import { buildEngineeringDirective, buildNativeToolReminder } from '../../ui/chat/model/engineeringDirective';
import { serializeVisibleChat } from '../../ui/chat/model/statelessTranscript';
import {
	buildToolInstructions,
	parseToolRequests,
	TOOL_FENCE_MARKER,
	type ToolRequest,
	type ToolSpec,
} from '../../ui/chat/tools/toolProtocol';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

/**
 * Live regression for #16: reproduce the EXACT thing the chat sends to steer the
 * model, then confirm the parser recovers the tool call it emits. Earlier this
 * test hand-rolled a simplified prompt and a custom tool, so the model answered
 * with a clean single-line call that never tripped the bug — a false pass. This
 * build instead assembles the message the way the real stateless path does
 * (engineering directive + a `<visible_chat_transcript>` + tool instructions for
 * the editor's real edit tools + the native-tool reminder), and reproduces the
 * captured failing scenario: "update the readme with a code block in backticks".
 * That makes the model write an edit call whose JSON argument embeds a fenced
 * ```bash block — the shape that used to split the tool block in two and vanish.
 *
 * The assertion only fires when the model actually emits a tool block. It can
 * refuse the directive as "prompt injection" or answer in prose — a steering
 * quirk, not the parse path under test — so a reply with no block is retried and
 * then skipped rather than failed.
 */
suite('Integration: backtick tool calls', function () {
	this.timeout(240_000);

	let session: Session;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();
		const context = initTestEnvironment();
		await context.secrets.store(session.profile.org.id, getTestToken());
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	// A representative slice of the editor's real edit tools, advertised exactly
	// as the chat advertises them (buildInstructionsForChatTools maps to these).
	const editSpecs: ToolSpec[] = [
		{
			name: 'read_file',
			description: 'Read the contents of a file.',
			args: '{"filePath": string, "startLine": number, "endLine": number}',
		},
		{
			name: 'replace_string_in_file',
			description: 'Replace an exact string in a file. Include surrounding context so the match is unique.',
			args: '{"filePath": string, "oldString": string, "newString": string}',
		},
		{
			name: 'create_file',
			description: 'Create a new file with the given content.',
			args: '{"filePath": string, "content": string}',
		},
	];

	const EDIT_TOOLS = new Set(editSpecs.map(spec => spec.name));

	// The user turn that drove the captured failure: an indented command block the
	// model is asked to convert into a fenced ```bash block, forcing backticks into
	// the edit call's JSON argument.
	const userTurn = [
		'The file /home/jon/Downloads/snake/readme.md currently contains:',
		'',
		'**Build & Run**',
		'',
		'    cd rust-snake',
		'    cargo run --release',
		'',
		'Requires a Rust toolchain. Install via rustup.rs if needed.',
		'',
		'update the readme with a code block in backticks: convert that indented command',
		'block into a fenced ```bash code block. Reply with ONLY the vscode-tool block',
		'that performs the edit, nothing else.',
	].join('\n');

	function buildStatelessLikeMessage(): string {
		const transcript = serializeVisibleChat([
			{ role: vscode.LanguageModelChatMessageRole.User, content: [{ value: userTurn } as never] },
		]);
		return [
			buildEngineeringDirective(EDIT_TOOLS),
			transcript,
			"The user's VS Code working directory: /home/jon/Downloads/snake",
			buildToolInstructions(editSpecs),
			buildNativeToolReminder(EDIT_TOOLS),
		].join('\n\n');
	}

	async function ask(): Promise<string> {
		const message = buildStatelessLikeMessage();
		let content = '';
		for await (const event of askRewstAi({
			session,
			orgId: session.profile.org.id,
			message,
			inactivityTimeoutMs: 150_000,
		})) {
			if (event.kind === 'complete') content = event.content;
			if (event.kind === 'error') throw new Error(event.message);
		}
		return content;
	}

	function carriesBacktickBlock(request: ToolRequest): boolean {
		return JSON.stringify(request.args).includes('```');
	}

	test('an edit call carrying a ``` code block is parsed, not dropped (#16)', async function () {
		let content = '';
		for (let attempt = 1; attempt <= 3; attempt++) {
			content = await ask();
			if (content.includes(TOOL_FENCE_MARKER)) break;
			console.log(`(attempt ${attempt}: no vscode-tool block — model answered in prose, retrying)`);
		}
		console.log('\n===== RAW SERVER REPLY =====\n' + content + '\n============================');

		if (!content.includes(TOOL_FENCE_MARKER)) {
			console.log('(model never emitted a tool block — steering refusal, not the parse path; skipping)');
			this.skip();
			return;
		}

		const requests = parseToolRequests(content);
		console.log(
			'===== PARSED REQUESTS =====\n' + JSON.stringify(requests, null, 2) + '\n===========================',
		);

		const edit = requests.find(request => EDIT_TOOLS.has(request.tool));
		assert.ok(
			edit,
			`the reply held a vscode-tool block but no edit request parsed out of it — the inner fence split the block (#16). Reply: ${content}`,
		);
		assert.ok(
			carriesBacktickBlock(edit),
			`expected the parsed edit call to keep its fenced code block, got: ${JSON.stringify(edit.args)}`,
		);
	});
});
