import { extPrefix } from '@global';
import {
	askRewstAi,
	seedConversation,
	SessionManager,
	type AskOptions,
	type ConversationEvent,
	type ConversationSource,
	type Session,
} from '@sessions';
import { log, TOOL_INSTRUCTIONS_BUDGET_CHARS } from '@utils';
import vscode from 'vscode';
import { prependInstructions } from '../promptContext';
import { ChunkGate } from '../tools/chunkGate';
import { mcpToolTail, renderToolDetails, TOOL_DETAILS_TOOL_NAME } from '../tools/toolCatalog';
import { buildToolInstructions, stripToolRequestBlocks, type ToolResult, type ToolSpec } from '../tools/toolProtocol';
import { buddyChatToolSpecs, runBuddyChatTool, type BuddyToolResult } from './buddyChatTools';
import { setContextUsage } from './contextUsage';
import { buildEngineeringDirective, buildNativeToolReminder, EDITOR_ONLY_REMINDER_TOOLS } from './engineeringDirective';
import { setLastAiAnswer } from './lastAnswer';
import { renderSourcesMarkdown } from './sources';
import { appendSeedChunks, serializeVisibleChat, type SeedChunk } from './statelessTranscript';
import {
	chatToolSpecs,
	extractTrailingToolResults,
	formatInProcessToolResults,
	partitionToolRequests,
	rejectedToolsNote,
	type ToolRequest,
} from './toolTranslation';

const VENDOR = 'rewst-buddy';
const FAMILY = 'roborewsty';
// Backstop on in-process buddy tool rounds within one chat response, so a backend
// that keeps requesting tools without ever answering can't loop indefinitely.
export const MAX_BUDDY_TOOL_ROUNDS = 8;
// Backstop on native-Rewst-tool redirect corrections within one backend attempt.
// We pretty much never want the "stopped" message to actually surface, so this
// escalates through many attempts before giving up (#175).
export const MAX_NATIVE_REDIRECT_ATTEMPTS = 25;
// Catalog-lookup (buddy_tool_details) rounds allowed per chat response. Separate
// from the Rewst tool-round cap so reading the manifest never spends the budget
// meant for real work, while a model that only ever asks for details still stops.
export const MAX_TOOL_DETAILS_ROUNDS = 6;
// The backend manages its own context window; these are picker-display
// estimates, not enforced limits.
const MAX_INPUT_TOKENS = 128_000;
const MAX_OUTPUT_TOKENS = 16_000;
const ANSWER_TAIL = 'Answer the latest user message, using the earlier messages as conversation context.';
const CONTINUE_TAIL = 'Continue.';

/** Seams for unit testing; production uses defaultProviderDeps. */
export interface ProviderDeps {
	ask(options: AskOptions): AsyncGenerator<ConversationEvent>;
	sessions(): Session[];
	sessionForOrg(orgId: string): Promise<Session>;
	workspaceRoot(): string | undefined;
	aiConfig(): {
		customInstructions: string;
		conversationType: string;
		showActivity: boolean;
		maxBuddyToolRounds: number;
	};
	/** Rewst (buddy) tools to advertise this turn through the in-process Buddy path. */
	buddyToolSpecs(): ToolSpec[];
	/** Runs one buddy tool in-process through the MCP capability surface. */
	runBuddyTool(name: string, args: Record<string, unknown>, orgId: string): Promise<BuddyToolResult>;
	/** Creates a disposable conversation and writes role-aware visible-history seeds. */
	seedConversation(
		session: Session,
		orgId: string,
		conversationType: string,
		chunks: readonly SeedChunk[],
	): Promise<string>;
}

/** Clamps the configured round cap to the manifest's 1–100 range; falls back to the default for non-numeric/invalid input. */
export function normalizeBuddyToolRounds(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_BUDDY_TOOL_ROUNDS;
	return Math.max(1, Math.min(100, Math.floor(value)));
}

/** Caps a buddy tool's args line in the activity card so a big arg blob can't flood the chat. */
export function truncateArgsLabel(argsLabel: string, maxLength = 140): string {
	return argsLabel.length > maxLength ? `${argsLabel.slice(0, maxLength - 1)}…` : argsLabel;
}

/**
 * Appends a re-request hint to the in-process results message when a buddy round
 * shared a reply with native (VS Code) or unavailable tool requests. Those aren't
 * run on the buddy path, so the backend is told to re-issue them rather than
 * having them silently dropped.
 */
function withDeferredToolsNote(
	message: string,
	vscodeCalls: readonly vscode.LanguageModelToolCallPart[],
	rejectedNames: readonly string[],
): string {
	const names = [...new Set([...vscodeCalls.map(call => call.name), ...rejectedNames])];
	if (names.length === 0) return message;
	const list = names.map(name => `\`${name}\``).join(', ');
	return `${message}\n\nOther tool requests in that reply were not run here (${list}). Re-request any you still need in a separate reply.`;
}

/** Keep the model's in-process Buddy requests visible in the seeded transcript. */
function formatBuddyRequestSummary(requests: readonly ToolRequest[]): string {
	return requests
		.map(request => {
			let args = '{}';
			try {
				args = JSON.stringify(request.args) ?? '{}';
			} catch {
				// Tool arguments came from the JSON protocol, but keep seeding safe if a
				// test seam supplies a non-serializable value.
			}
			return `Requested Buddy tool: ${request.tool}${args === '{}' ? '' : ` ${truncateArgsLabel(args)}`}`;
		})
		.join('\n');
}

function formatBuddyAssistantTurn(remainder: string, requests: readonly ToolRequest[]): string {
	return [remainder.trim(), formatBuddyRequestSummary(requests)].filter(Boolean).join('\n\n');
}

type StatusEvent = Extract<ConversationEvent, { kind: 'status' }>;
type NativeRewstToolStatus = StatusEvent & { tool: NonNullable<StatusEvent['tool']> };

function shouldRedirectNativeRewstTool(status: StatusEvent): status is NativeRewstToolStatus {
	// In the VS Code chat context every tool the model should use is either a
	// buddy (MCP) tool run in-process or a VS Code editor tool requested via a
	// vscode-tool fenced block. A server-side Rewst tool call is always wrong
	// here — redirect unconditionally regardless of the tool name.
	return status.tool !== undefined;
}

function formatInlineName(name: string): string {
	const safe = name.replace(/[`\r\n<>]/g, '').trim();
	return safe ? `\`${safe}\`` : '`unknown`';
}

function formatBuddyToolList(specs: readonly ToolSpec[], limit = 12): string {
	const shown = specs.slice(0, limit).map(spec => formatInlineName(spec.name));
	const remaining = specs.length - shown.length;
	return remaining > 0 ? `${shown.join(', ')}, and ${remaining} more` : shown.join(', ');
}

/** Inline, XML-tag-free rendering of the native tool's already-compact args for the correction prompt. */
function sanitizeArgsForPrompt(args: string): string {
	return args.replace(/[`<>]/g, '').replace(/\s+/g, ' ').trim();
}

/** A stronger, still-neutral opening line once the first correction wasn't followed. */
function escalationPrefix(attempt: number, maxAttempts: number): string[] {
	return attempt > 1
		? [`This is correction attempt ${attempt} of ${maxAttempts}; the previous transport note was not followed.`]
		: [];
}

function buildNativeToBuddyCorrection(
	tool: NativeRewstToolStatus['tool'],
	buddySpecs: readonly ToolSpec[],
	attempt: number,
	maxAttempts: number,
): string {
	const names = formatBuddyToolList(buddySpecs);
	const sanitizedArgs = tool.args ? sanitizeArgsForPrompt(tool.args) : '';
	const lines = [
		...escalationPrefix(attempt, maxAttempts),
		`Transport note: the previous server-side Rewst tool status was for ${formatInlineName(tool.name)}.`,
	];
	if (sanitizedArgs) {
		// Carry the arguments the backend already resolved so the redirected turn
		// reuses those ids/filters in the Buddy call instead of rediscovering them.
		lines.push(`Those arguments were: ${sanitizedArgs}`);
	}
	lines.push(
		'Continue with the local tool protocol: request local Buddy tools by writing fenced `vscode-tool` JSON blocks so VS Code can route them through the extension and apply its normal approval and sandbox flow.',
		`Available buddy_* tool names this turn: ${names}.`,
		'If one of those tools is needed, reply with the `vscode-tool` block only; otherwise answer from the current conversation.',
	);
	return lines.join('\n');
}

function buildNativeToEditorCorrection(
	tool: NativeRewstToolStatus['tool'],
	attempt: number,
	maxAttempts: number,
): string {
	const sanitizedArgs = tool.args ? sanitizeArgsForPrompt(tool.args) : '';
	const lines = [
		...escalationPrefix(attempt, maxAttempts),
		`Transport note: the previous server-side Rewst tool status was for ${formatInlineName(tool.name)}, which is a VS Code editor tool that must never be invoked as a native Rewst function call.`,
	];
	if (sanitizedArgs) {
		lines.push(`Those arguments were: ${sanitizedArgs}`);
	}
	lines.push(
		`Request it with a fenced \`vscode-tool\` JSON block instead: \`\`\`vscode-tool\n{"tool": "${tool.name}", "args": {…}}\n\`\`\``,
		'Reply with the vscode-tool block only; do not invoke it as a native function call again.',
	);
	return lines.join('\n');
}

function rewstUserEmailMetadata(session: Session): string {
	const username = session.profile.user.username;
	if (typeof username !== 'string') return '';
	const email = username.replace(/[\r\n]+/g, ' ').trim();
	return email ? `Rewst session metadata:\nCurrent Rewst user email: ${email}` : '';
}

/**
 * Native Rewst tools run server-side, so they can't be true VS Code tool cards
 * (no invocation round-trip). A tool status renders as a compact card-like
 * blockquote — tool name, then its args on a second line — to read as close to
 * VS Code's native tool pills as plain markdown allows; other activity (a doc
 * search) stays a plain italic line (#22). In-process buddy tools (run by the
 * extension through the user's session) are labeled "Buddy tool" so they read
 * apart from the backend's own server-side "Rewst tool" calls (#88).
 */
function formatActivityLine(status: {
	label: string;
	tool?: { name: string; args?: string; local?: boolean };
}): string {
	if (status.tool) {
		const args = status.tool.args ? `\n> \`${status.tool.args}\`` : '';
		const kind = status.tool.local ? 'Buddy tool' : 'Rewst tool';
		return `\n\n> 🔧 **${kind}** · \`${status.tool.name}\`${args}\n`;
	}
	return `\n\n> _${status.label}_\n`;
}

export const defaultProviderDeps: ProviderDeps = {
	ask: askRewstAi,
	sessions: () => SessionManager.getActiveSessions(),
	sessionForOrg: orgId => SessionManager.getSessionForOrg(orgId),
	workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
	aiConfig: () => {
		const config = vscode.workspace.getConfiguration(`${extPrefix}.ai`);
		return {
			customInstructions: config.get<string>('customInstructions', ''),
			conversationType: config.get<string>('conversationType', 'HELP_DOCS'),
			showActivity: config.get<boolean>('showActivity', true),
			maxBuddyToolRounds: normalizeBuddyToolRounds(config.get<number>('maxBuddyToolRounds')),
		};
	},
	buddyToolSpecs: buddyChatToolSpecs,
	runBuddyTool: runBuddyChatTool,
	seedConversation,
};

/**
 * Contributes RoboRewsty to VS Code's chat model picker: one model per active
 * Rewst session org. Chat requests stream through the existing askRewstAi
 * subscription; tool calling is translated between VS Code's tool contract
 * and RoboRewsty's text protocol (toolTranslation.ts). Every backend ask is
 * disposable: the visible transcript is seeded with explicit USER/ASSISTANT
 * records before the subscription starts, then the conversation is deleted.
 */
export class RoboRewstyChatModelProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
	private changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

	private registration: vscode.Disposable | undefined;
	private sessionListener: vscode.Disposable | undefined;

	// The directive, native-tool reminder, and tool-instruction text are pure
	// functions of the permitted-tool set, but get rebuilt (heavy string
	// assembly) every turn. Memoize by a sorted tool-name key; the set is stable
	// across a chat, so these almost always hit.
	private directiveCache = new Map<string, string>();
	private nativeReminderCache = new Map<string, string>();
	private toolInstructionsCache = new Map<string, string>();

	constructor(private readonly deps: ProviderDeps = defaultProviderDeps) {}

	init(): this {
		this.registration = vscode.lm.registerLanguageModelChatProvider(VENDOR, this);
		this.sessionListener = SessionManager.onSessionChange(() => this.changeEmitter.fire());
		log.debug('RoboRewstyChatModelProvider: registered', VENDOR);
		return this;
	}

	private cachedEngineeringDirective(permittedNames: ReadonlySet<string>): string {
		const key = [...permittedNames].sort().join('|');
		let value = this.directiveCache.get(key);
		if (value === undefined) {
			value = buildEngineeringDirective(permittedNames);
			this.directiveCache.set(key, value);
		}
		return value;
	}

	private cachedNativeToolReminder(permittedNames: ReadonlySet<string>): string {
		const key = [...permittedNames].sort().join('|');
		let value = this.nativeReminderCache.get(key);
		if (value === undefined) {
			value = buildNativeToolReminder(permittedNames);
			this.nativeReminderCache.set(key, value);
		}
		return value;
	}

	private cachedToolInstructions(specs: readonly ToolSpec[]): string {
		const key = specs
			.map(spec => `${spec.name}\u001f${spec.args}\u001f${spec.description}`)
			.sort()
			.join('|');
		let value = this.toolInstructionsCache.get(key);
		if (value === undefined) {
			// Budgeted: the full manifest of every advertised tool is far larger than
			// one backend message may be, so tools past the budget are advertised as
			// catalog summaries the model expands with buddy_tool_details.
			value = buildToolInstructions([...specs], { budget: TOOL_INSTRUCTIONS_BUDGET_CHARS });
			this.toolInstructionsCache.set(key, value);
		}
		return value;
	}

	dispose(): void {
		this.registration?.dispose();
		this.registration = undefined;
		this.sessionListener?.dispose();
		this.sessionListener = undefined;
		this.changeEmitter.dispose();
	}

	provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): vscode.LanguageModelChatInformation[] {
		const sessions = this.deps.sessions();
		return sessions.map(session => ({
			id: session.profile.org.id,
			name: sessions.length === 1 ? 'Cage-Free Rewsty' : `Cage-Free Rewsty (${session.profile.org.name})`,
			family: FAMILY,
			version: '1.0.0',
			detail: session.profile.org.name,
			tooltip: `Rewst's AI assistant for ${session.profile.org.name}`,
			maxInputTokens: MAX_INPUT_TOKENS,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			capabilities: { toolCalling: true },
		}));
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		const value =
			typeof text === 'string'
				? text
				: text.content.map(part => ((part as { value?: unknown }).value as string) ?? '').join('');
		return Math.ceil(value.length / 4);
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		if (messages.length === 0) throw new Error('No messages in the chat request.');
		const orgId = model.id;
		const session = await this.deps.sessionForOrg(orgId);
		const tools = options.tools ?? [];
		const vscodeNames = new Set(tools.map(tool => tool.name));
		// Buddy (MCP) tools the chat advertises and runs in-process, so they survive
		// VS Code's 128-tool cap on options.tools. A name VS Code already passed this
		// turn stays on the native path (keeping its built-in approval card) and is
		// dropped here to avoid a duplicate advertisement.
		const allBuddySpecs = this.deps.buddyToolSpecs();
		const buddySpecs = allBuddySpecs.filter(spec => !vscodeNames.has(spec.name));
		const buddyNames = new Set(buddySpecs.map(spec => spec.name));
		// The catalog's expansion tool. Handled by this provider (not the capability
		// registry) so it can describe VS Code editor tools too; it rides the buddy
		// path so a request for it runs in-process like any other Buddy tool.
		buddyNames.add(TOOL_DETAILS_TOOL_NAME);
		// Redirecting a server-side Rewst tool to the local path keys off ALL
		// advertised Buddy tools, not just the in-process subset: when VS Code has
		// already supplied every Buddy tool natively, buddySpecs is empty yet the
		// local Buddy path still exists, so the native Rewst tool must still be
		// redirected (its fenced request then routes back through VS Code natively).
		// Editor tools available this turn — used to pick the right correction message
		// when a native call to one of these is intercepted and redirected.
		const editorToolNames = new Set(EDITOR_ONLY_REMINDER_TOOLS.filter(t => vscodeNames.has(t)));
		const permittedNames = new Set<string>([...vscodeNames, ...buddyNames]);
		// Editor tools first: the budgeted manifest keeps the earliest specs in full
		// detail, and those are the ones used on nearly every turn. A Buddy tool VS
		// Code handed back under its MCP name (`mcp_<server>_buddy_x`, when the user
		// also configured our /mcp bridge as a chat MCP server) is the same operation
		// as the in-process spec, so it is advertised once — on the in-process path,
		// which keeps the working-scope and approval gates. The prefixed name stays in
		// vscodeNames, so a model that asks for it anyway still gets routed.
		const inProcessBuddyNames = new Set(allBuddySpecs.map(spec => spec.name));
		const editorSpecs = chatToolSpecs(tools).filter(spec => {
			const tail = mcpToolTail(spec.name);
			return tail === undefined || !inProcessBuddyNames.has(tail);
		});
		const advertisedSpecs = [...editorSpecs, ...buddySpecs];
		const { customInstructions, conversationType, showActivity, maxBuddyToolRounds } = this.deps.aiConfig();

		const trailingResults = extractTrailingToolResults(messages);
		// Internal Buddy rounds happen before VS Code can replay the response, so
		// keep their role-aware interaction records alongside the visible history.
		// The current tail remains the latest result/correction; it is promoted into
		// this seed history before a later tail replaces it.
		let seedHistory = serializeVisibleChat(messages);

		// Fire-and-forget delete of a transient per-ask conversation — must not
		// delay the turn from completing. Every ask seeds a fresh conversation and
		// the conversation is disposable once the stream ends.
		const fireDelete = (id: string): void => {
			void session.sdk?.deleteConversation({ id })?.catch(error => {
				log.debug('RoboRewstyChatModelProvider: conversation delete failed', id, error);
			});
		};
		let conversationId: string | undefined;
		const deleteCurrentConversation = (): void => {
			const id = conversationId;
			conversationId = undefined;
			if (id) fireDelete(id);
		};
		let message: string;

		// Everything reported this turn, used only to decide whether a retry is safe.
		let emittedText = '';
		// Continuation requests render into the same chat bubble as the previous
		// round's text, so their first text needs a paragraph break.
		let needsSeparator = trailingResults !== undefined;
		// The last activity label shown, to collapse exact back-to-back repeats.
		let lastStatusLabel: string | undefined;
		const emitText = (text: string): void => {
			if (!text) return;
			if (needsSeparator) {
				text = `\n\n${text}`;
				needsSeparator = false;
			}
			progress.report(new vscode.LanguageModelTextPart(text));
			emittedText += text;
		};
		// Surfaces substantive activity (searches, native tool calls) as unobtrusive
		// blockquote lines so a multi-step turn is legible. Housekeeping statuses
		// (thinking, summarizing) are filtered out by the caller (event.activity).
		const emitStatus = (
			status: { label: string; tool?: { name: string; args?: string; local?: boolean } },
			gate: ChunkGate,
		): void => {
			if (!showActivity || status.label === lastStatusLabel) return;
			lastStatusLabel = status.label;
			// Drain the gate's already-safe answer text first so the activity line
			// stays ordered after it (gate.push('') keeps any partial fence held).
			emitText(gate.push(''));
			// Activity lines are meta, not answer text: report directly so they
			// never enter emittedText (continuity and saved-answer stay clean).
			progress.report(new vscode.LanguageModelTextPart(formatActivityLine(status)));
			needsSeparator = true;
		};
		let nativeRewstToolRedirectAttempts = 0;
		// The tail of the ask message: answer instruction on a fresh user turn,
		// continuation after tool results, or a redirect correction.
		let tail = trailingResults !== undefined ? CONTINUE_TAIL : ANSWER_TAIL;
		let tailForSeed: string | undefined;
		const promoteTail = (): void => {
			if (!tailForSeed) return;
			seedHistory = appendSeedChunks(seedHistory, [{ role: 'USER', content: tailForSeed }]);
			tailForSeed = undefined;
		};
		// One retry with a brand-new conversation after a backend error that
		// produced no output yet and ran no buddy tool.
		let retriedOnce = false;
		let buddyRounds = 0;
		let detailsRounds = 0;
		// Once a buddy tool has actually run, its side effects make a restart unsafe.
		let ranBuddyTool = false;

		// Each iteration seeds and asks one disposable backend conversation.
		try {
			turns: for (;;) {
				// A `continue turns` leaves the previous disposable conversation behind
				// until this point. Delete it before creating the replacement; the outer
				// finally handles thrown iterator/ask errors and early returns as well.
				deleteCurrentConversation();
				const gate = new ChunkGate();
				let completeContent = '';
				let sources: ConversationSource[] = [];
				let sawComplete = false;
				message = this.buildAskMessage(session, customInstructions, permittedNames, advertisedSpecs, tail);
				conversationId = await this.deps.seedConversation(session, orgId, conversationType, seedHistory);

				for await (const event of this.deps.ask({
					session,
					orgId,
					message,
					conversationId,
					conversationType,
					cancellation: token,
				})) {
					if (token.isCancellationRequested) {
						deleteCurrentConversation();
						return;
					}
					switch (event.kind) {
						case 'registered':
							break;
						case 'status':
							if (shouldRedirectNativeRewstTool(event)) {
								if (nativeRewstToolRedirectAttempts >= MAX_NATIVE_REDIRECT_ATTEMPTS) {
									emitText(gate.push(''));
									needsSeparator = true;
									emitText(
										'*Stopped after a server-side Rewst tool was requested again. Ask again to continue with the local Buddy tools.*\n',
									);
									deleteCurrentConversation();
									return;
								}
								nativeRewstToolRedirectAttempts++;
								// Preserve any previous tool-result/correction tail before the
								// redirect replaces it. Otherwise a redirect after a Buddy round
								// would erase the only copy of that result.
								promoteTail();
								tail = editorToolNames.has(event.tool.name)
									? buildNativeToEditorCorrection(
											event.tool,
											nativeRewstToolRedirectAttempts,
											MAX_NATIVE_REDIRECT_ATTEMPTS,
										)
									: buildNativeToBuddyCorrection(
											event.tool,
											allBuddySpecs,
											nativeRewstToolRedirectAttempts,
											MAX_NATIVE_REDIRECT_ATTEMPTS,
										);
								tailForSeed = tail;
								deleteCurrentConversation();
								needsSeparator = true;
								continue turns;
							}
							// Only surface real steps; skip thinking/summarizing churn.
							if (event.activity) emitStatus(event, gate);
							break;
						case 'usage':
							// Stand-in for VS Code's native context gauge, which a model
							// provider can't update; the status bar renders the latest.
							setContextUsage({
								orgId,
								orgName: model.detail,
								totalTokens: event.totalTokens,
								maxTokens: event.maxTokens,
								percent: event.percent,
							});
							break;
						case 'conversation':
							conversationId = event.conversationId;
							break;
						case 'chunk':
							emitText(gate.push(event.text));
							break;
						case 'complete':
							sawComplete = true;
							completeContent = event.content;
							sources = event.sources;
							conversationId = event.conversationId ?? conversationId;
							break;
						case 'approval':
							emitText(
								'\n\n*RoboRewsty needs approval to run a Rewst-side action. Rewst Buddy no longer exposes Rewst approval as a VS Code chat tool; use the Rewst web app or the MCP approval flow for Rewst-side actions.*\n',
							);
							// The backend turn is paused awaiting an approval we never
							// send, so it never completes. The conversation is disposable.
							deleteCurrentConversation();
							return;
						case 'error':
							if (emittedText === '' && !ranBuddyTool && !retriedOnce) {
								retriedOnce = true;
								deleteCurrentConversation();
								log.debug(
									'RoboRewstyChatModelProvider: ask errored before output, retrying with a fresh conversation',
									event.message,
								);
								lastStatusLabel = undefined;
								nativeRewstToolRedirectAttempts = 0;
								continue turns;
							}
							deleteCurrentConversation();
							throw new Error(event.message);
					}
					if (sawComplete) break;
				}

				if (!sawComplete) {
					deleteCurrentConversation();
					return; // cancelled or the stream ended early
				}

				// Whatever the chunk stream didn't already show.
				const remainder =
					gate.streamedAny || gate.blocked ? gate.flush() : stripToolRequestBlocks(completeContent);

				// Always partition, even with no tools passed: a request for an
				// unavailable tool must surface as the rejection note instead of
				// being silently stripped by the chunk gate.
				const { vscodeCalls, buddyRequests, rejectedNames } = partitionToolRequests(
					completeContent,
					vscodeNames,
					buddyNames,
				);

				// Buddy (MCP) tools run in-process. Their results become the tail of the
				// next fresh seed, so they never depend on VS Code's capped options.tools
				// list. Native/unavailable requests in the same reply are
				// not run here; the results message tells the backend to re-issue them.
				if (buddyRequests.length > 0) {
					emitText(remainder);
					// A catalog lookup is not Rewst work: it reads this turn's own tool
					// specs, so charging it against the tool-round cap would spend the
					// user's budget on reading the manifest instead of doing the task.
					// It gets its own, separate ceiling so a model that only ever asks
					// for details still terminates.
					const chargeable = buddyRequests.filter(request => request.tool !== TOOL_DETAILS_TOOL_NAME);
					if (chargeable.length === 0) {
						if (detailsRounds >= MAX_TOOL_DETAILS_ROUNDS) {
							needsSeparator = true;
							emitText(
								'*Stopped after repeated tool-detail lookups without a final answer. Ask again to continue.*\n',
							);
							deleteCurrentConversation();
							return;
						}
						detailsRounds += 1;
					}
					// Cap BEFORE running: a capped round must not execute, or a write
					// would take effect with no result fed back and no final answer.
					if (chargeable.length > 0 && buddyRounds >= maxBuddyToolRounds) {
						needsSeparator = true;
						emitText(
							`*Stopped after ${maxBuddyToolRounds} Rewst tool call${maxBuddyToolRounds === 1 ? '' : 's'} without a final answer. Ask again to continue.*\n`,
						);
						deleteCurrentConversation();
						return;
					}
					if (chargeable.length > 0) buddyRounds += 1;
					const results: ToolResult[] = [];
					for (const request of buddyRequests) {
						// Stop launching further tools (a later one may be a write) once
						// the user cancels mid-sequence.
						if (token.isCancellationRequested) {
							deleteCurrentConversation();
							return;
						}
						const argsJson = JSON.stringify(request.args);
						const argsLabel = argsJson === '{}' ? '' : argsJson;
						emitStatus(
							{
								// Args are part of the dedupe label so repeated calls to one
								// tool with different args still render as distinct cards.
								label: `Running Buddy tool: ${request.tool} ${argsJson}`,
								// local: true → renders as "Buddy tool", apart from the
								// backend's server-side "Rewst tool" calls. The card already
								// shows the name on its own line, so args is the args alone.
								tool: {
									name: request.tool,
									args: argsLabel ? truncateArgsLabel(argsLabel) : undefined,
									local: true,
								},
							},
							gate,
						);
						// The catalog lookup is answered locally from this turn's advertised
						// specs — it touches no Rewst data, so it is not a buddy-tool run
						// and must not block the stateless downgrade path.
						if (request.tool === TOOL_DETAILS_TOOL_NAME) {
							results.push({
								tool: request.tool,
								argsLabel,
								ok: true,
								output: renderToolDetails(advertisedSpecs, request.args),
							});
							continue;
						}
						const result = await this.deps.runBuddyTool(request.tool, request.args, orgId);
						ranBuddyTool = true;
						results.push({
							tool: request.tool,
							argsLabel,
							ok: !result.isError,
							output: result.text,
						});
					}
					// Promote the prior round's result/correction before appending this
					// round, so the next disposable conversation contains every earlier
					// interaction and the latest result remains the current ask tail.
					promoteTail();
					const resultMessage = withDeferredToolsNote(
						formatInProcessToolResults(results),
						vscodeCalls,
						rejectedNames,
					);
					const assistantTurn = formatBuddyAssistantTurn(remainder, buddyRequests);
					if (assistantTurn)
						seedHistory = appendSeedChunks(seedHistory, [{ role: 'ASSISTANT', content: assistantTurn }]);
					tail = resultMessage;
					tailForSeed = resultMessage;
					deleteCurrentConversation();
					needsSeparator = true;
					continue turns;
				}

				if (vscodeCalls.length > 0) {
					emitText(remainder);
					for (const call of vscodeCalls) progress.report(call);
					deleteCurrentConversation();
					return;
				}

				let finalText = remainder;
				if (rejectedNames.length > 0) finalText += rejectedToolsNote(rejectedNames);
				if (sources.length > 0) finalText += renderSourcesMarkdown(sources);
				emitText(finalText);
				setLastAiAnswer(stripToolRequestBlocks(completeContent));
				deleteCurrentConversation();
				return;
			}
		} finally {
			deleteCurrentConversation();
		}
	}

	/** Build the small per-ask prompt; visible history is sent as role-aware seeds. */
	private buildAskMessage(
		session: Session,
		customInstructions: string,
		permittedNames: ReadonlySet<string>,
		specs: readonly ToolSpec[],
		tail: string,
	): string {
		let message = prependInstructions(tail, customInstructions);
		const metadata = rewstUserEmailMetadata(session);
		if (metadata) message = `${metadata}\n\n${message}`;
		const root = this.deps.workspaceRoot();
		if (root) message += `\n\nThe user's VS Code working directory: ${root}`;
		if (specs.length > 0) message += `\n\n${this.cachedToolInstructions(specs)}`;
		message = [this.cachedEngineeringDirective(permittedNames), message].filter(Boolean).join('\n\n');
		// Repeat the native-tool curb at the most recent position in the prompt.
		message += `\n\n${this.cachedNativeToolReminder(permittedNames)}`;
		return message;
	}
}
