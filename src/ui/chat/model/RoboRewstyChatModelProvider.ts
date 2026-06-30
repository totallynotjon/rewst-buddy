import {
	askRewstAi,
	SessionManager,
	type AskOptions,
	type ConversationEvent,
	type ConversationSource,
	type Session,
} from '@sessions';
import { extPrefix } from '@global';
import { log } from '@utils';
import vscode from 'vscode';
import { ChunkGate } from '../tools/chunkGate';
import {
	buildToolInstructions,
	stripToolRequestBlocks,
	type ToolRequest,
	type ToolResult,
	type ToolSpec,
} from '../tools/toolProtocol';
import { prependInstructions } from '../promptContext';
import { buddyChatToolSpecs, runBuddyChatTool, type BuddyToolResult } from './buddyChatTools';
import { buildEngineeringDirective, buildNativeToolReminder } from './engineeringDirective';
import { conversationMap, nextTurnKey, prefixKey, spineDepth } from './conversationMap';
import { formatBreadcrumb, parseLatestBreadcrumb } from './breadcrumb';
import { setLastAiAnswer } from './lastAnswer';
import { setContextUsage } from './contextUsage';
import { serializeVisibleChat } from './statelessTranscript';
import { renderSourcesMarkdown } from './sources';
import {
	chatToolSpecs,
	collectToolCalls,
	extractTrailingToolResults,
	formatInProcessToolResults,
	formatToolResultsMessage,
	partitionToolRequests,
	rejectedToolsNote,
} from './toolTranslation';

const VENDOR = 'rewst-buddy';
const FAMILY = 'roborewsty';
// Backstop on in-process buddy tool rounds within one chat response, so a backend
// that keeps requesting tools without ever answering can't loop indefinitely.
export const MAX_BUDDY_TOOL_ROUNDS = 8;
// The backend manages its own context window; these are picker-display
// estimates, not enforced limits.
const MAX_INPUT_TOKENS = 128_000;
const MAX_OUTPUT_TOKENS = 16_000;

/** Seams for unit testing; production uses defaultProviderDeps. */
export interface ProviderDeps {
	ask(options: AskOptions): AsyncGenerator<ConversationEvent>;
	sessions(): Session[];
	sessionForOrg(orgId: string): Session;
	workspaceRoot(): string | undefined;
	aiConfig(): {
		customInstructions: string;
		conversationType: string;
		showActivity: boolean;
		maxBuddyToolRounds: number;
	};
	/** Rewst (buddy) tools to advertise this turn; empty unless the MCP server is on. */
	buddyToolSpecs(): ToolSpec[];
	/** Runs one buddy tool in-process through the MCP capability surface. */
	runBuddyTool(name: string, args: Record<string, unknown>, orgId: string): Promise<BuddyToolResult>;
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

type StatusEvent = Extract<ConversationEvent, { kind: 'status' }>;
type NativeRewstToolStatus = StatusEvent & { tool: NonNullable<StatusEvent['tool']> };

function shouldRedirectNativeRewstTool(
	status: StatusEvent,
	buddyNames: ReadonlySet<string>,
): status is NativeRewstToolStatus {
	return status.tool !== undefined && buddyNames.size > 0;
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

function buildNativeToBuddyCorrection(tool: NativeRewstToolStatus['tool'], buddySpecs: readonly ToolSpec[]): string {
	const names = formatBuddyToolList(buddySpecs);
	return [
		`Transport note: the previous server-side Rewst tool status was for ${formatInlineName(tool.name)}.`,
		'Continue with the local tool protocol: request local Buddy tools by writing fenced `vscode-tool` JSON blocks so VS Code can route them through the extension and apply its normal approval and sandbox flow.',
		`Available buddy_* tool names this turn: ${names}.`,
		'If one of those tools is needed, reply with the `vscode-tool` block only; otherwise answer from the current conversation.',
	].join('\n');
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
};

/**
 * Contributes RoboRewsty to VS Code's chat model picker: one model per active
 * Rewst session org. Chat requests stream through the existing askRewstAi
 * subscription; tool calling is translated between VS Code's tool contract
 * and RoboRewsty's text protocol (toolTranslation.ts). Continuity is hybrid: a
 * warm backend conversation is reused when the transcript is a pure append
 * (conversationMap.ts + a hidden breadcrumb), and any turn that can't follow one
 * falls back to a fresh, stateless conversation seeded from the visible transcript.
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
			.map(spec => spec.name)
			.sort()
			.join('|');
		let value = this.toolInstructionsCache.get(key);
		if (value === undefined) {
			value = buildToolInstructions([...specs]);
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
		const session = this.deps.sessionForOrg(orgId);
		const tools = options.tools ?? [];
		const vscodeNames = new Set(tools.map(tool => tool.name));
		// Buddy (MCP) tools the chat advertises and runs in-process, so they survive
		// VS Code's 128-tool cap on options.tools. A name VS Code already passed this
		// turn stays on the native path (keeping its built-in approval card) and is
		// dropped here to avoid a duplicate advertisement.
		const buddySpecs = this.deps.buddyToolSpecs().filter(spec => !vscodeNames.has(spec.name));
		const buddyNames = new Set(buddySpecs.map(spec => spec.name));
		const permittedNames = new Set<string>([...vscodeNames, ...buddyNames]);
		const advertisedSpecs = [...chatToolSpecs(tools), ...buddySpecs];
		const { customInstructions, conversationType, showActivity, maxBuddyToolRounds } = this.deps.aiConfig();

		const trailingResults = extractTrailingToolResults(messages);
		const toolCalls = trailingResults ? collectToolCalls(messages) : undefined;

		// Fire-and-forget delete of a superseded transient conversation — must not
		// delay the turn from completing.
		const fireDelete = (id: string): void => {
			void session.sdk?.deleteConversation({ id })?.catch(error => {
				log.debug('RoboRewstyChatModelProvider: stale conversation delete failed', id, error);
			});
		};
		// Reuse a warm backend conversation when the transcript is a pure append;
		// undefined forks a fresh (stateless) one. A rewound branch is deleted here.
		let conversationId = this.recoverConversation(orgId, messages, trailingResults, fireDelete);

		// Everything reported this turn, for predicting the next request's key.
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
		const storeContinuity = (calls: readonly vscode.LanguageModelToolCallPart[]): void => {
			if (!conversationId) return;
			// Primary: bind the conversation to the exact callIds VS Code will
			// replay (drift-proof) for tool rounds. Secondary: the user-spine hash
			// for plain-text follow-ups that carry no tool calls.
			if (calls.length > 0)
				conversationMap.storeByCallIds(
					calls.map(call => call.callId),
					conversationId,
				);
			conversationMap.store(nextTurnKey(orgId, messages), conversationId, spineDepth(messages));
		};
		// Hidden marker echoed back next turn for exact, collision-proof recovery
		// (breadcrumb.ts). Reported directly so it never enters the saved answer or
		// the continuity hash (it lives in the assistant message, not the spine).
		const emitBreadcrumb = (): void => {
			if (!conversationId) return;
			progress.report(
				new vscode.LanguageModelTextPart(
					formatBreadcrumb(conversationId, spineDepth(messages), nextTurnKey(orgId, messages)),
				),
			);
		};
		let redirectedNativeRewstTool = false;
		// Outer loop: a reuse turn that the backend can't follow downgrades to
		// a fresh, stateless turn ONCE. The first attempt reuses when recovery
		// found a conversation; the retry always starts fresh.
		for (;;) {
			const reusing = conversationId !== undefined;
			const reusedId = conversationId;
			let message = await this.buildTurnMessage(
				session,
				!reusing,
				messages,
				trailingResults,
				toolCalls,
				customInstructions,
				permittedNames,
				advertisedSpecs,
			);
			let downgrade = false;
			// In-process buddy tool rounds taken within this chat response.
			let buddyRounds = 0;
			// Once a buddy tool has actually run, its side effects (and the consumed
			// backend round) make a stateless restart unsafe — a write would re-apply.
			let ranBuddyTool = false;

			// Each iteration is one backend turn. A reused conversation that the
			// backend cannot follow downgrades to a stateless retry.
			turns: for (;;) {
				const gate = new ChunkGate();
				let completeContent = '';
				let sources: ConversationSource[] = [];
				let sawComplete = false;

				for await (const event of this.deps.ask({
					session,
					orgId,
					message,
					conversationId,
					conversationType,
					cancellation: token,
				})) {
					if (token.isCancellationRequested) return;
					switch (event.kind) {
						case 'registered':
							break;
						case 'status':
							if (shouldRedirectNativeRewstTool(event, buddyNames)) {
								if (redirectedNativeRewstTool) {
									emitText(gate.push(''));
									needsSeparator = true;
									emitText(
										'*Stopped after a server-side Rewst tool was requested again. Ask again to continue with the local Buddy tools.*\n',
									);
									storeContinuity([]);
									emitBreadcrumb();
									return;
								}
								redirectedNativeRewstTool = true;
								message = buildNativeToBuddyCorrection(event.tool, buddySpecs);
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
							// send, so it never completes — do not record it as reusable.
							// Forget any prior mapping so the next message starts fresh.
							if (conversationId) conversationMap.forget(conversationId);
							return;
						case 'error':
							// A reused conversation the backend can't follow: revert
							// to a fresh stateless turn once, provided nothing has
							// streamed yet (avoids double output) and no buddy tool has
							// run (a stateless restart would re-execute its side effects).
							if (reusing && emittedText === '' && !ranBuddyTool) {
								log.debug(
									'RoboRewstyChatModelProvider: reuse turn errored before output, downgrading to stateless',
									reusedId,
									event.message,
								);
								downgrade = true;
								break turns;
							}
							throw new Error(event.message);
					}
					if (sawComplete) break;
				}

				if (!sawComplete) return; // cancelled or the stream ended early

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

				// Buddy (MCP) tools run in-process and feed their results back into the
				// same warm conversation, so they never depend on VS Code's capped
				// options.tools list. Native/unavailable requests in the same reply are
				// not run here; the results message tells the backend to re-issue them.
				if (buddyRequests.length > 0) {
					emitText(remainder);
					// Cap BEFORE running: a capped round must not execute, or a write
					// would take effect with no result fed back and no final answer.
					if (buddyRounds >= maxBuddyToolRounds) {
						needsSeparator = true;
						emitText(
							`*Stopped after ${maxBuddyToolRounds} Rewst tool call${maxBuddyToolRounds === 1 ? '' : 's'} without a final answer. Ask again to continue.*\n`,
						);
						storeContinuity([]);
						emitBreadcrumb();
						return;
					}
					buddyRounds += 1;
					const results: ToolResult[] = [];
					for (const request of buddyRequests) {
						// Stop launching further tools (a later one may be a write) once
						// the user cancels mid-sequence.
						if (token.isCancellationRequested) return;
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
						const result = await this.deps.runBuddyTool(request.tool, request.args, orgId);
						ranBuddyTool = true;
						results.push({
							tool: request.tool,
							argsLabel,
							ok: !result.isError,
							output: result.text,
						});
					}
					message = withDeferredToolsNote(formatInProcessToolResults(results), vscodeCalls, rejectedNames);
					needsSeparator = true;
					continue turns;
				}

				if (vscodeCalls.length > 0) {
					emitText(remainder);
					for (const call of vscodeCalls) progress.report(call);
					storeContinuity(vscodeCalls);
					return;
				}

				let finalText = remainder;
				if (rejectedNames.length > 0) finalText += rejectedToolsNote(rejectedNames);
				if (sources.length > 0) finalText += renderSourcesMarkdown(sources);
				emitText(finalText);
				setLastAiAnswer(stripToolRequestBlocks(completeContent));
				storeContinuity([]);
				emitBreadcrumb();
				return;
			}

			// Reached only by breaking out of the turns loop to downgrade.
			if (!downgrade) return;
			if (reusedId) {
				conversationMap.forget(reusedId);
				fireDelete(reusedId);
			}
			conversationId = undefined;
			emittedText = '';
			needsSeparator = trailingResults !== undefined;
			lastStatusLabel = undefined;
			// The stateless retry is a fresh attempt, so its first native tool should
			// get its own redirect rather than the abandoned reuse turn's stop.
			redirectedNativeRewstTool = false;
		}
	}

	/**
	 * Resolve a warm backend conversation to reuse, or undefined to fork a fresh
	 * stateless one. Priority: tool-call ids (authoritative for tool rounds) →
	 * breadcrumb (exact per-chat id, content + tip validated) → spine hash. A
	 * spine-hash hit that sits behind the conversation's tip means the transcript
	 * was rewound or an earlier message edited — that branch is dropped and
	 * deleted here, and the caller forks fresh.
	 */
	private recoverConversation(
		orgId: string,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		trailingResults: ReturnType<typeof extractTrailingToolResults>,
		fireDelete: (id: string) => void,
	): string | undefined {
		if (trailingResults) {
			const byCall = conversationMap.lookupByCallIds(trailingResults.map(result => result.callId));
			if (byCall) return byCall;
		}
		const key = prefixKey(orgId, messages);
		const crumb = parseLatestBreadcrumb(messages);
		if (
			crumb &&
			crumb.spineHash === key &&
			conversationMap.breadcrumbFollowable(crumb.conversationId, crumb.depth)
		) {
			return crumb.conversationId;
		}
		const hit = conversationMap.lookup(key);
		if (hit?.followable) return hit.conversationId;
		if (hit) {
			conversationMap.forget(hit.conversationId);
			fireDelete(hit.conversationId);
		}
		return undefined;
	}

	/** Build this attempt's message: stateless full transcript, or a lean reuse turn. */
	private async buildTurnMessage(
		session: Session,
		stateless: boolean,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		trailingResults: ReturnType<typeof extractTrailingToolResults>,
		toolCalls: ReturnType<typeof collectToolCalls> | undefined,
		customInstructions: string,
		permittedNames: ReadonlySet<string>,
		specs: readonly ToolSpec[],
	): Promise<string> {
		if (stateless) return this.buildStatelessMessage(session, messages, customInstructions, permittedNames, specs);
		if (trailingResults) return formatToolResultsMessage(trailingResults, toolCalls ?? new Map());
		return this.buildReuseMessage(messages, customInstructions, permittedNames, specs);
	}

	/**
	 * Lean message for reusing a warm conversation: only the new user turn (plus
	 * cheap workspace context and tool instructions). The conversation already
	 * holds the transcript and the engineering directive, so neither is re-sent —
	 * this is the speed win over the stateless path.
	 */
	private async buildReuseMessage(
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		customInstructions: string,
		permittedNames: ReadonlySet<string>,
		specs: readonly ToolSpec[],
	): Promise<string> {
		let message = prependInstructions(this.trailingText(messages), customInstructions);
		const root = this.deps.workspaceRoot();
		if (root) message += `\n\nThe user's VS Code working directory: ${root}`;
		if (specs.length > 0) message += `\n\n${this.cachedToolInstructions(specs)}`;
		message += `\n\n${this.cachedNativeToolReminder(permittedNames)}`;
		return message;
	}

	/** Concatenated text of the trailing (user) message. */
	private trailingText(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
		const last = messages[messages.length - 1];
		let text = '';
		for (const part of last.content) {
			if (typeof part === 'string') text += part;
			else if (typeof (part as { value?: unknown }).value === 'string') text += (part as { value: string }).value;
		}
		return text;
	}

	private async buildStatelessMessage(
		session: Session,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		customInstructions: string,
		permittedNames: ReadonlySet<string>,
		specs: readonly ToolSpec[],
	): Promise<string> {
		let message = prependInstructions(serializeVisibleChat(messages), customInstructions);
		const metadata = rewstUserEmailMetadata(session);
		if (metadata) message = `${metadata}\n\n${message}`;
		const root = this.deps.workspaceRoot();
		if (root) message += `\n\nThe user's VS Code working directory: ${root}`;
		if (specs.length > 0) message += `\n\n${this.cachedToolInstructions(specs)}`;
		message = [this.cachedEngineeringDirective(permittedNames), message].filter(Boolean).join('\n\n');
		// Highest-recency line: the directive sits far above the latest user turn
		// (buried in the transcript), so repeat the native-tool curb last.
		message += `\n\n${this.cachedNativeToolReminder(permittedNames)}`;
		return message;
	}
}
