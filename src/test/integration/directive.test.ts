import * as assert from 'assert';
import * as Mocha from 'mocha';
import { askRewstAi, Session } from '@sessions';
import { clearCachedSession, getTestSession, getTestToken, hasTestToken, initTestEnvironment } from '@test';
import { buildEngineeringDirective } from '../../ui/chat/model/engineeringDirective';
import { ALL_TOOL_SPECS } from '../../ui/chat/model/lmTools';
import {
	buildToolInstructions,
	parseToolRequests,
	type ToolRequest,
	type ToolSpec,
} from '../../ui/chat/tools/toolProtocol';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

/**
 * Live steering harness for the engineering directive: sends real questions to
 * RoboRewsty exactly as the chat model provider would (directive + question +
 * tool instructions) and inspects WHICH tools the assistant requests. No
 * requested tool is ever executed — the first reply's tool choice is the
 * signal. Logs every full reply so directive revisions can be evaluated.
 */
suite('Integration: engineering directive steering', function () {
	this.timeout(240_000);

	let session: Session;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();
		// askRewstAi reads the cookie from secrets, keyed by the primary org.
		const context = initTestEnvironment();
		await context.secrets.store(session.profile.org.id, getTestToken());
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	async function turn(
		question: string,
		attempt = 1,
		extraSpecs: ToolSpec[] = [],
	): Promise<{ content: string; requests: ToolRequest[]; statuses: string[] }> {
		const specs = [...ALL_TOOL_SPECS, ...extraSpecs];
		const directive = buildEngineeringDirective(new Set(specs.map(spec => spec.name)));
		const message = `${directive}\n\n${question}\n\n${buildToolInstructions(specs)}`;
		let content = '';
		const statuses: string[] = [];
		for await (const event of askRewstAi({
			session,
			orgId: session.profile.org.id,
			message,
			inactivityTimeoutMs: 150_000,
		})) {
			if (event.kind === 'status') statuses.push(event.label);
			if (event.kind === 'complete') content = event.content;
			if (event.kind === 'error') {
				// Backend throttling shows up as an interruption; retry once.
				if (event.message.includes('interrupted') && attempt < 3) {
					console.log(`(interrupted — retrying, attempt ${attempt + 1})`);
					await new Promise(resolve => setTimeout(resolve, 15_000));
					return turn(question, attempt + 1, extraSpecs);
				}
				throw new Error(event.message);
			}
		}
		const requests = parseToolRequests(content);
		console.log(`\n===== Question =====\n${question}`);
		console.log(`===== Server-side activity =====\n${statuses.join('\n') || '(none)'}`);
		console.log(
			`===== Requested tools =====\n${requests.map(r => `${r.tool} ${JSON.stringify(r.args)}`).join('\n') || '(none)'}`,
		);
		console.log(`===== Full reply =====\n${content}\n======================\n`);
		return { content, requests, statuses };
	}

	// The server reports a gitbook doc-search loop via the `searching` status,
	// mapped to this label in ConversationEventMapper.
	const DOC_SEARCH_LABEL = 'Searching documentation';
	const searchedDocs = (statuses: string[]): boolean => statuses.some(label => label.includes(DOC_SEARCH_LABEL));

	test('org variable question routes to GraphQL schema introspection', async () => {
		const { requests } = await turn('What org variables are set in this org?');
		assert.ok(requests.length > 0, 'expected a tool request, got a prose answer');
		const tools = requests.map(request => request.tool);
		assert.ok(
			tools.every(tool => tool === 'buddy_graphql_schema' || tool === 'buddy_graphql'),
			`expected only GraphQL tools, got: ${tools.join(', ')}`,
		);
	});

	test('general web question routes to web_search', async () => {
		const { requests } = await turn(
			'Search the web for the current latest stable version of the "graphql-ws" npm package and tell me what it is.',
		);
		assert.ok(requests.length > 0, 'expected a tool request, got a prose answer');
		assert.ok(
			requests.some(request => request.tool === 'web_search'),
			`expected web_search, got: ${requests.map(r => r.tool).join(', ')}`,
		);
	});

	test('a current-events question searches the web instead of refusing', async () => {
		// The reported failure (#27): a news / "latest in the last N hours" question
		// gets a "can't browse / no realtime access" refusal with no tool call,
		// unless the user prefixes "use agents to search". It must search on its own.
		const { requests } = await turn('What is the latest news out of the Democratic Party in the last 24 hours?');
		assert.ok(requests.length > 0, 'expected a web_search request, got a prose refusal');
		assert.ok(
			requests.some(request => request.tool === 'web_search'),
			`expected web_search, got: ${requests.map(r => r.tool).join(', ')}`,
		);
	});

	test('workflow listing routes to GraphQL, not native platform tools', async () => {
		const { requests } = await turn('List the workflows in this org.');
		assert.ok(requests.length > 0, 'expected a tool request, got a prose answer');
		const tools = requests.map(request => request.tool);
		assert.ok(
			tools.every(tool => tool === 'buddy_graphql_schema' || tool === 'buddy_graphql'),
			`expected only GraphQL tools, got: ${tools.join(', ')}`,
		);
	});

	test('a non-Rewst engineering task does not trigger a documentation search', async () => {
		const { statuses } = await turn(
			'Outline three concrete improvements to a Rust terminal Snake game and sketch an implementation plan for each. This is plain Rust, nothing to do with Rewst.',
		);
		assert.ok(
			!searchedDocs(statuses),
			`expected no documentation search for a non-Rewst task, got statuses: ${statuses.join(', ') || '(none)'}`,
		);
	});

	test('a plain opening turn does not reflexively search documentation', async () => {
		// The reported failure: a new chat opens with a gitbook_retriever doc search
		// for no reason. A benign first turn must answer directly, no search.
		const { statuses } = await turn('Hey — can you help me work on this codebase?');
		assert.ok(
			!searchedDocs(statuses),
			`expected no documentation search on a plain opening turn, got statuses: ${statuses.join(', ') || '(none)'}`,
		);
	});

	test('a single editor-tool request is not preceded by a spurious native call', async () => {
		// The reported failure: the assistant fires one unrelated native wrapper
		// (e.g. listWorkflow) as a warm-up, ignores it, then runs the real tool.
		// Server-side native tools surface as "Running tool: …" statuses; an
		// editor-tool request does not, so any such status here is a stray call.
		const { statuses } = await turn(
			'Use the list_template_links tool to show which local files are linked to templates.',
		);
		const nativeCalls = statuses.filter(label => label.startsWith('Running tool:'));
		assert.deepStrictEqual(
			nativeCalls,
			[],
			`expected no native tool calls before the editor tool, got: ${nativeCalls.join(', ') || '(none)'}`,
		);
	});

	test('an explicit insert edit tool request is a vscode-tool block, not a native call', async function () {
		// Live regression from testing #27: on an opening edit request, the assistant
		// tried to invoke insert_edit_into_file as a native/Rewst tool. It must treat
		// VS Code edit tools exactly like read/list tools: fenced vscode-tool blocks.
		const insertSpec: ToolSpec = {
			name: 'insert_edit_into_file',
			args: '{"filePath": string, "code": string, "explanation": string}',
			description: 'Insert code into an existing local workspace file.',
		};
		let result: { content: string; requests: ToolRequest[]; statuses: string[] };
		try {
			result = await turn(
				'Use the insert_edit_into_file tool to add a short note to /tmp/readme.md saying hello. Do not answer in prose.',
				1,
				[insertSpec],
			);
		} catch (error) {
			if (error instanceof Error && /interrupted/i.test(error.message)) {
				console.log(`(backend kept interrupting the insert edit turn — skipping: ${error.message})`);
				this.skip();
			}
			throw error;
		}
		const { content, requests, statuses } = result;
		const nativeInsertCall = statuses.some(
			label => label.startsWith('Running tool:') && /insert_edit_into_file/i.test(label),
		);
		assert.ok(
			!nativeInsertCall,
			`insert_edit_into_file must be a vscode-tool block, not a native call; statuses: ${statuses.join(', ')}`,
		);
		assert.ok(
			requests.some(request => request.tool === 'insert_edit_into_file'),
			`expected an insert_edit_into_file vscode-tool request, got requests [${requests
				.map(r => r.tool)
				.join(', ')}] and content: ${content.slice(0, 300)}`,
		);
	});

	test('a todo-list tool is invoked as a vscode-tool block, not a native call', async function () {
		// Jon's report (#27): with a todo tool available, the assistant called it as a
		// NATIVE function call (its name collides with a tool it knows natively), which
		// never reaches VS Code and fails with an unknown-tool error. It must come back
		// as a vscode-tool block instead. Asking it outright to use the tool keeps the
		// reply a short tool block — the backend interrupts longer planning turns.
		const todoSpec: ToolSpec = {
			name: 'manage_todo_list',
			args: '{"todos": string[]}',
			description: 'Record and update an ordered todo list for the current task.',
		};
		let result: { content: string; requests: ToolRequest[]; statuses: string[] };
		try {
			result = await turn(
				'Use the manage_todo_list tool to record an ordered todo list for this multi-step task: read a CSV of new users, validate each row, create each user via an external API, then post a summary to Slack.',
				1,
				[todoSpec],
			);
		} catch (error) {
			// A persistent backend interruption is not a steering signal; turn() already
			// retries it. Don't let it fail the suite.
			if (error instanceof Error && /interrupted/i.test(error.message)) {
				console.log(`(backend kept interrupting the todo turn — skipping: ${error.message})`);
				this.skip();
			}
			throw error;
		}
		const { content, requests, statuses } = result;
		// A native call surfaces as a "Running tool: …" status; an editor-tool request
		// is parsed out of a vscode-tool block into requests. We want the latter.
		const nativeTodoCall = statuses.some(
			label => label.startsWith('Running tool:') && /manage_todo_list/i.test(label),
		);
		assert.ok(
			!nativeTodoCall,
			`manage_todo_list must be a vscode-tool block, not a native call; statuses: ${statuses.join(', ')}`,
		);
		assert.ok(
			requests.some(request => request.tool === 'manage_todo_list'),
			`expected a manage_todo_list vscode-tool request, got requests [${requests
				.map(r => r.tool)
				.join(', ')}] and content: ${content.slice(0, 300)}`,
		);
	});

	test('an explicit Rewst-docs request is still allowed to search', async () => {
		// Negative control: the curb must not over-suppress when the user actually
		// asks about Rewst's own documentation.
		const { statuses, content } = await turn(
			"Search Rewst's own documentation for how the platform's noop tasks work and cite what you find.",
		);
		assert.ok(
			searchedDocs(statuses) || /noop/i.test(content),
			`expected an explicit docs request to search or answer about noops, got statuses: ${statuses.join(', ') || '(none)'}`,
		);
	});
});
