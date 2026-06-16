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
import { buildWorkspaceOverview } from '../tools/workspaceTools';
import { prependInstructions } from '../promptContext';
import { buildEngineeringDirective } from './engineeringDirective';
import { latestConversationStore, type RetainedConversation } from './latestConversationStore';
import { setLastAiAnswer } from './lastAnswer';
import { serializeVisibleChat, visibleChatKey, visibleChatPrefixKey } from './statelessTranscript';
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

export const defaultProviderDeps: ProviderDeps = {
	ask: askRewstAi,
	sessions: () => SessionManager.getActiveSessions(),
	sessionForOrg: orgId => SessionManager.getSessionForOrg(orgId),
	confirmApproval: confirmApprovalModal,
	workspaceOverview: () => buildWorkspaceOverview(),
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
 * and RoboRewsty's text protocol (toolTranslation.ts). VS Code's visible chat
 * transcript is the source of truth for memory; transient backend conversations
 * are retained only for cleanup and approval/tool-call handoff.
 */
export class RoboRewstyChatModelProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
	private changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

	private registration: vscode.Disposable | undefined;
	private sessionListener: vscode.Disposable | undefined;

	constructor(private readonly deps: ProviderDeps = defaultProviderDeps) {}

	init(): this {
		this.registration = vscode.lm.registerLanguageModelChatProvider(VENDOR, this);
		this.sessionListener = SessionManager.onSessionChange(() => this.changeEmitter.fire());
		log.debug('RoboRewstyChatModelProvider: registered', VENDOR);
		return this;
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
		// Tool invocations (run by VS Code after this turn) have no org context;
		// point the GraphQL tool at this turn's org.
		setActiveAiOrg(orgId);

		const settings = this.deps.toolSettings();
		const tools = filterToolsBySettings(options.tools, settings);
		const permittedNames = new Set(tools.map(tool => tool.name));
		const { customInstructions, conversationType, showActivity } = this.deps.aiConfig();

		const currentKey = visibleChatKey(orgId, messages);
		const prefixKey = visibleChatPrefixKey(orgId, messages);
		const trailingResults = extractTrailingToolResults(messages);
		let conversationId: string | undefined;
		let message: string;
		let previousRetained: RetainedConversation | undefined;

		if (trailingResults) {
			const calls = collectToolCalls(messages);
			const approval = trailingResults
				.map(result => calls.get(result.callId))
				.find(call => call?.name === APPROVAL_TOOL_NAME);
			if (approval) {
				// The user confirmed the in-chat approval, so the tool is now
				// allow-listed — re-send the original request it interrupted.
				const input = approval.input as Partial<ApprovalToolInput> | undefined;
				if (typeof input?.resume !== 'string') throw new Error('Approval call carried no resumable request.');
				message = input.resume;
				conversationId = latestConversationStore.lookupByCallIds(
					trailingResults.map(result => result.callId),
				)?.conversationId;
				previousRetained = latestConversationStore.lookup(prefixKey);
			} else {
				message = await this.buildStatelessMessage(
					messages,
					customInstructions,
					settings,
					permittedNames,
					tools,
				);
				previousRetained =
					latestConversationStore.lookupByCallIds(trailingResults.map(result => result.callId)) ??
					latestConversationStore.lookup(prefixKey);
			}
		} else {
			message = await this.buildStatelessMessage(messages, customInstructions, settings, permittedNames, tools);
			previousRetained = latestConversationStore.lookup(prefixKey);
		}

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
		const emitStatus = (label: string, gate: ChunkGate): void => {
			if (!showActivity || label === lastStatusLabel) return;
			lastStatusLabel = label;
			// Drain the gate's already-safe answer text first so the activity line
			// stays ordered after it (gate.push('') keeps any partial fence held).
			emitText(gate.push(''));
			// Activity lines are meta, not answer text: report directly so they
			// never enter emittedText (continuity and saved-answer stay clean).
			progress.report(new vscode.LanguageModelTextPart(`\n\n> _${label}_\n`));
			needsSeparator = true;
		};
		const bindPausedConversation = (calls: readonly vscode.LanguageModelToolCallPart[]): void => {
			if (!conversationId) return;
			if (calls.length > 0)
				latestConversationStore.bindCallIds(
					calls.map(call => call.callId),
					currentKey,
					conversationId,
				);
		};
		const retainSuccessfulConversation = async (
			calls: readonly vscode.LanguageModelToolCallPart[],
		): Promise<void> => {
			if (!conversationId) return;
			if (calls.length > 0)
				latestConversationStore.bindCallIds(
					calls.map(call => call.callId),
					currentKey,
					conversationId,
				);
			const stale = previousRetained?.conversationId;
			latestConversationStore.storeLatest(currentKey, conversationId, previousRetained);
			if (stale && stale !== conversationId) {
				try {
					await session.sdk?.deleteConversation({ id: stale });
				} catch (error) {
					log.debug('RoboRewstyChatModelProvider: stale conversation delete failed', stale, error);
				}
			}
		};
		// Tools allow-listed for a one-time Approve; reverted once the turn ends.
		const toolsToRevert = new Set<string>();

		try {
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
							if (event.activity) emitStatus(event.label, gate);
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
								bindPausedConversation([call]);
								return;
							}
							const choice = await this.deps.confirmApproval(named);
							if (choice === 'cancel') {
								emitText(
									'\n\n*Approval declined — the Rewst action was not run. Ask again if you change your mind.*\n',
								);
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
					await retainSuccessfulConversation(calls);
					return;
				}

				let finalText = remainder;
				if (rejectedNames.length > 0) finalText += rejectedToolsNote(rejectedNames);
				if (sources.length > 0) finalText += renderSourcesMarkdown(sources);
				emitText(finalText);
				setLastAiAnswer(stripToolRequestBlocks(completeContent));
				await retainSuccessfulConversation([]);
				return;
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
		if (tools.length > 0) message += `\n\n${buildInstructionsForChatTools(tools)}`;
		message = [buildEngineeringDirective(permittedNames), message].filter(Boolean).join('\n\n');
		return message;
	}
}
