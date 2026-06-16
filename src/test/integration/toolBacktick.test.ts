import * as assert from 'assert';
import * as Mocha from 'mocha';
import { askRewstAi, Session } from '@sessions';
import { clearCachedSession, getTestSession, getTestToken, hasTestToken, initTestEnvironment } from '@test';
import { buildEngineeringDirective } from '../../ui/chat/model/engineeringDirective';
import { ALL_TOOL_SPECS } from '../../ui/chat/model/lmTools';
import {
	buildToolInstructions,
	parseToolRequests,
	TOOL_FENCE_MARKER,
	type ToolSpec,
} from '../../ui/chat/tools/toolProtocol';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

/**
 * Live regression for #16: force RoboRewsty to emit a vscode-tool call whose JSON
 * argument carries a fenced ``` code block, dump the RAW reply, and confirm the
 * parser recovers the call. The bug: the inner fence split the block in two so the
 * request failed to parse and was silently dropped, leaving the chat empty.
 *
 * The assertion only fires when the model actually emits a tool block. It will
 * sometimes refuse the directive as "prompt injection" or answer in prose — a
 * steering quirk, not the parse path under test — so a reply with no block is
 * retried and then skipped rather than failed.
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

	const noteSpec: ToolSpec = {
		name: 'save_note',
		args: '{"text": string}',
		description: 'Save a markdown note verbatim to the workspace.',
	};

	const question = [
		'I am writing internal Jinja docs. Use the save_note tool to store this short markdown note',
		'verbatim (including the code block) so I can find it later. Reply with ONLY the vscode-tool',
		'block and no other prose. Note content:',
		'',
		'# Looping in Jinja',
		'Example:',
		'```jinja',
		'{% for item in items %}{{ item }}{% endfor %}',
		'```',
	].join('\n');

	async function ask(): Promise<string> {
		const specs = [...ALL_TOOL_SPECS, noteSpec];
		const directive = buildEngineeringDirective(new Set(specs.map(spec => spec.name)));
		const message = `${directive}\n\n${question}\n\n${buildToolInstructions(specs)}`;
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

	test('a tool call carrying a ``` code block is parsed, not dropped (#16)', async function () {
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

		const note = requests.find(request => request.tool === 'save_note');
		assert.ok(
			note,
			`the reply contained a vscode-tool block but no save_note request parsed out of it — the inner fence split the block (#16). Reply: ${content}`,
		);
		assert.ok(
			typeof note.args.text === 'string' && (note.args.text as string).includes('```'),
			`expected the parsed note to keep its fenced code block, got: ${JSON.stringify(note.args)}`,
		);
	});
});
