import {
	askRewstAi,
	SessionManager,
	type ApprovalTool,
	type AskOptions,
	type ConversationEvent,
	type ConversationSource,
	type Session,
} from '@sessions';
import { extPrefix } from '@global';
import { log } from '@utils';
import vscode from 'vscode';
import { ChunkGate } from '../tools/chunkGate';
import { stripToolRequestBlocks } from '../tools/toolProtocol';
import { createCachedWorkspaceOverview, wireWorkspaceOverviewInvalidation } from '../tools/workspaceTools';
import { prependInstructions } from '../promptContext';
import { buildEngineeringDirective, buildNativeToolReminder } from './engineeringDirective';
import { conversationMap, nextTurnKey, prefixKey, spineDepth } from './conversationMap';
import { formatBreadcrumb, parseLatestBreadcrumb } from './breadcrumb';
import { setLastAiAnswer } from './lastAnswer';
import { setContextUsage } from './contextUsage';
import { serializeVisibleChat } from './statelessTranscript';
import {
	APPROVAL_TOOL_NAME,
	readAiToolSettings,
	setActiveAiOrg,
	takeOnceApprovals,
	type AiToolSettings,
	type ApprovalToolInput,
} from './lmTools';
import { renderSourcesMarkdown } from './sources';
import {
	buildInstructionsForChatTools,
	collectToolCalls,
	extractTrailingToolResults,
	filterToolsBySettings,
	formatToolResultsMessage,
	rejectedToolsNote,
	translateToolRequests,
} from './toolTranslation';

const VENDOR = 'rewst-buddy';
const FAMILY = 'roborewsty';
// The backend manages its own context window; these are picker-display
// estimates, not enforced limits.
const MAX_INPUT_TOKENS = 128_000;
const MAX_OUTPUT_TOKENS = 16_000;

type ApprovalChoice = 'approve' | 'always' | 'cancel';

/** Seams for unit testing; production uses defaultProviderDeps. */
export interface ProviderDeps {
	ask(options: AskOptions): AsyncGenerator<ConversationEvent>;
	sessions(): Session[];
	sessionForOrg(orgId: string): Session;
	confirmApproval(tools: ApprovalTool[]): Promise<ApprovalChoice>;
	workspaceOverview(): Promise<string | undefined>;
	/** Marks the cached workspace overview stale; absent in tests (no-op). */
	invalidateOverview?(): void;
	workspaceRoot(): string | undefined;
	aiConfig(): { customInstructions: string; conversationType: string; showActivity: boolean };
	toolSettings(): AiToolSettings;
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

/**
 * Native Rewst tools run server-side, so they can't be true VS Code tool cards
 * (no invocation round-trip). A tool status renders as a compact card-like
 * blockquote — tool name, then its args on a second line — to read as close to
 * VS Code's native tool pills as plain markdown allows; other activity (a doc
 * search) stays a plain italic line (#22).
 */
function formatActivityLine(status: { label: string; tool?: { name: string; args?: string } }): string {
	if (status.tool) {
		const args = status.tool.args ? `\n> \`${status.tool.args}\`` : '';
		return `\n\n> 🔧 **Rewst tool** · \`${status.tool.name}\`${args}\n`;
	}
	return `\n\n> _${status.label}_\n`;
}

async function confirmApprovalModal(tools: ApprovalTool[]): Promise<ApprovalChoice> {
	const detail = tools
		.map(tool => (tool.args === undefined ? tool.name : `${tool.name}\n${truncate(safeJson(tool.args), 500)}`))
		.join('\n\n');
	const alwaysLabel = tools.length === 1 ? `Always Allow "${tools[0].name}"` : 'Always Allow These Tools';
	const choice = await vscode.window.showInformationMessage(
		'RoboRewsty needs your approval to run a Rewst action',
		{ modal: true, detail },
		'Approve',
		alwaysLabel,
	);
	if (choice === 'Approve') return 'approve';
	if (choice === alwaysLabel) return 'always';
	return 'cancel';
}

const defaultOverviewCache = createCachedWorkspaceOverview();

export const defaultProviderDeps: ProviderDeps = {
	ask: askRewstAi,
	sessions: () => SessionManager.getActiveSessions(),
	sessionForOrg: orgId => SessionManager.getSessionForOrg(orgId),
	confirmApproval: confirmApprovalModal,
	workspaceOverview: () => defaultOverviewCache.get(),
	invalidateOverview: () => defaultOverviewCache.invalidate(),
	workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
	aiConfig: () => {
		const config = vscode.workspace.getConfiguration(`${extPrefix}.ai`);
		return {
			customInstructions: config.get<string>('customInstructions', ''),
			conversationType: config.get<string>('conversationType', 'HELP_DOCS'),
			showActivity: config.get<boolean>('showActivity', true),
		};
	},
	toolSettings: readAiToolSettings,
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
	private overviewInvalidation: vscode.Disposable | undefined;

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
		// Keep the cached workspace overview fresh: invalidate it on top-level file
		// and template-link changes, with the cache's TTL as the backstop.
		if (this.deps.invalidateOverview) {
			this.overviewInvalidation = wireWorkspaceOverviewInvalidation(() => this.deps.invalidateOverview?.());
		}
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

	private cachedToolInstructions(tools: readonly vscode.LanguageModelChatTool[]): string {
		const key = tools
			.map(tool => tool.name)
			.sort()
			.join('|');
		let value = this.toolInstructionsCache.get(key);
		if (value === undefined) {
			value = buildInstructionsForChatTools(tools);
			this.toolInstructionsCache.set(key, value);
		}
		return value;
	}

	dispose(): void {
		this.registration?.dispose();
		this.registration = undefined;
		this.sessionListener?.dispose();
		this.sessionListener = undefined;
		this.overviewInvalidation?.dispose();
		this.overviewInvalidation = undefined;
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
		// Tool invocations (run by VS Code after this turn) have no org context;
		// point the GraphQL tool at this turn's org.
		setActiveAiOrg(orgId);

		const settings = this.deps.toolSettings();
		const tools = filterToolsBySettings(options.tools, settings);
		const permittedNames = new Set(tools.map(tool => tool.name));
		const { customInstructions, conversationType, showActivity } = this.deps.aiConfig();

		const trailingResults = extractTrailingToolResults(messages);
		const toolCalls = trailingResults ? collectToolCalls(messages) : undefined;

		// In-chat approval re-send: the user confirmed a paused Rewst action, so
		// the original request is replayed verbatim once the tool is allow-listed.
		let approvalResume: string | undefined;
		if (trailingResults && toolCalls) {
			const approval = trailingResults
				.map(result => toolCalls.get(result.callId))
				.find(call => call?.name === APPROVAL_TOOL_NAME);
			if (approval) {
				const input = approval.input as Partial<ApprovalToolInput> | undefined;
				if (typeof input?.resume !== 'string') throw new Error('Approval call carried no resumable request.');
				approvalResume = input.resume;
			}
		}

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
			status: { label: string; tool?: { name: string; args?: string } },
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
		// Tools allow-listed for a one-time Approve; reverted once the turn ends.
		const toolsToRevert = new Set<string>();

		try {
			// Outer loop: a reuse turn that the backend can't follow downgrades to
			// a fresh, stateless turn ONCE. The first attempt reuses when recovery
			// found a conversation; the retry always starts fresh.
			for (;;) {
				const reusing = conversationId !== undefined;
				const reusedId = conversationId;
				const message = await this.buildTurnMessage(
					!reusing,
					approvalResume,
					messages,
					trailingResults,
					toolCalls,
					customInstructions,
					settings,
					permittedNames,
					tools,
				);
				let downgrade = false;

				// Each iteration is one backend turn; approvals re-send the same
				// message once the tool is allow-listed (resuming a paused request
				// does not re-run the tool — see the Rewst approval semantics).
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
							case 'approval': {
								const named = event.tools.filter(tool => tool.name);
								if (named.length === 0) {
									emitText(
										"\n\n*RoboRewsty needs approval to run a Rewst action, but it didn't name the tool, so it can't be approved from here. You can approve it in the Rewst web app.*\n",
									);
									storeContinuity([]);
									return;
								}
								if (options.tools?.some(tool => tool.name === APPROVAL_TOOL_NAME)) {
									// In-chat confirmation: emit a call to the approval tool.
									// VS Code renders Continue/Cancel inline; confirming
									// allow-lists the tool(s) and re-enters with the resume
									// payload, cancelling simply ends the turn.
									const argsPreview = named
										.filter(tool => tool.args !== undefined)
										.map(tool => `${tool.name}: ${truncate(safeJson(tool.args), 500)}`)
										.join('\n');
									const input: ApprovalToolInput = {
										toolNames: named.map(tool => tool.name),
										orgId,
										resume: message,
										...(argsPreview ? { argsPreview } : {}),
									};
									const call = new vscode.LanguageModelToolCallPart(
										`rewst-approval-${Date.now().toString(36)}`,
										APPROVAL_TOOL_NAME,
										input,
									);
									progress.report(call);
									storeContinuity([call]);
									return;
								}
								const choice = await this.deps.confirmApproval(named);
								if (choice === 'cancel') {
									emitText(
										'\n\n*Approval declined — the Rewst action was not run. Ask again if you change your mind.*\n',
									);
									storeContinuity([]);
									return;
								}
								for (const tool of named) {
									try {
										await session.sdk?.addAllowedTool({ toolName: tool.name });
										if (choice === 'approve') toolsToRevert.add(tool.name);
									} catch (error) {
										log.notifyError(
											`Could not approve "${tool.name}": ${error instanceof Error ? error.message : error}`,
										);
									}
								}
								needsSeparator = emittedText.length > 0;
								continue turns;
							}
							case 'error':
								// A reused conversation the backend can't follow: revert
								// to a fresh stateless turn once, provided nothing has
								// streamed yet (avoids double output).
								if (reusing && emittedText === '') {
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

					// Always translate, even with no tools passed: a request for an
					// unavailable tool must surface as the rejection note instead of
					// being silently stripped by the chunk gate.
					const { calls, rejectedNames } = translateToolRequests(completeContent, permittedNames);

					if (calls.length > 0) {
						emitText(remainder);
						for (const call of calls) progress.report(call);
						storeContinuity(calls);
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
			}
		} finally {
			// Undo one-time approvals now that the tool has already run server-side
			// (modal Approve and in-chat confirmations alike).
			for (const toolName of new Set([...toolsToRevert, ...takeOnceApprovals(orgId)])) {
				try {
					await session.sdk?.removeAllowedTool({ toolName });
				} catch (error) {
					log.debug('RoboRewstyChatModelProvider: approval revert failed', toolName, error);
				}
			}
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
		stateless: boolean,
		approvalResume: string | undefined,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		trailingResults: ReturnType<typeof extractTrailingToolResults>,
		toolCalls: ReturnType<typeof collectToolCalls> | undefined,
		customInstructions: string,
		settings: AiToolSettings,
		permittedNames: ReadonlySet<string>,
		tools: readonly vscode.LanguageModelChatTool[],
	): Promise<string> {
		// Stateless is checked first on purpose: a downgrade rebuilds the full
		// transcript even for an approval re-send. The paused message may be a lean
		// reuse message, which would lose context on a fresh conversation; the
		// transcript carries the original request, so the allow-listed action still
		// replays correctly. When reusing, the approval re-send wins (exact replay).
		if (stateless) return this.buildStatelessMessage(messages, customInstructions, settings, permittedNames, tools);
		if (approvalResume !== undefined) return approvalResume;
		if (trailingResults) return formatToolResultsMessage(trailingResults, toolCalls ?? new Map());
		return this.buildReuseMessage(messages, customInstructions, settings, permittedNames, tools);
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
		settings: AiToolSettings,
		permittedNames: ReadonlySet<string>,
		tools: readonly vscode.LanguageModelChatTool[],
	): Promise<string> {
		let message = prependInstructions(this.trailingText(messages), customInstructions);
		if (settings.enableWorkspaceTools && permittedNames.size > 0) {
			const overview = await this.deps.workspaceOverview();
			if (overview) message += `\n\nThe user's VS Code workspace:\n${overview}`;
		} else {
			const root = this.deps.workspaceRoot();
			if (root) message += `\n\nThe user's VS Code working directory: ${root}`;
		}
		if (tools.length > 0) message += `\n\n${this.cachedToolInstructions(tools)}`;
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
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		customInstructions: string,
		settings: AiToolSettings,
		permittedNames: ReadonlySet<string>,
		tools: readonly vscode.LanguageModelChatTool[],
	): Promise<string> {
		let message = prependInstructions(serializeVisibleChat(messages), customInstructions);
		if (settings.enableWorkspaceTools && permittedNames.size > 0) {
			const overview = await this.deps.workspaceOverview();
			if (overview) message += `\n\nThe user's VS Code workspace:\n${overview}`;
		} else {
			const root = this.deps.workspaceRoot();
			if (root) message += `\n\nThe user's VS Code working directory: ${root}`;
		}
		if (tools.length > 0) message += `\n\n${this.cachedToolInstructions(tools)}`;
		message = [this.cachedEngineeringDirective(permittedNames), message].filter(Boolean).join('\n\n');
		// Highest-recency line: the directive sits far above the latest user turn
		// (buried in the transcript), so repeat the native-tool curb last.
		message += `\n\n${this.cachedNativeToolReminder(permittedNames)}`;
		return message;
	}
}
