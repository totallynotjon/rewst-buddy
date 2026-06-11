import { context, extPrefix } from '@global';
import { askRewstAi, Session, SessionManager, type ApprovalTool, type ConversationSource } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { pickOrganization } from '../pickers';
import { findPriorTurnState } from './chatHistory';
import { extractCodeBlocks } from './codeBlocks';
import { conversationLabel, formatConversationTranscript } from './conversationTranscript';
import {
	firstReferencedFileUri,
	formatPromptWithReferences,
	prependInstructions,
	resolveReferences,
} from './promptContext';
import { ChunkGate } from './tools/chunkGate';
import { diffStats, renderUnifiedDiff } from './tools/diffRender';
import {
	blockedRepeatResult,
	buildToolInstructions,
	formatToolResults,
	parseToolRequests,
	RequestDeduper,
	stripToolRequestBlocks,
	type ToolResult,
} from './tools/toolProtocol';
import { buildWorkspaceOverview, EDIT_TOOL_SPECS, runToolRequests, WORKSPACE_TOOL_SPECS } from './tools/workspaceTools';
import { WEB_TOOL_SPECS } from './tools/webTools';
import { COMMAND_TOOL_SPECS } from './tools/commandTool';
import { createGraphqlDeps, GRAPHQL_TOOL_SPECS } from './tools/graphqlTool';

const PARTICIPANT_ID = 'rewst-buddy.rewst';
// Command an inline approval button invokes, and the prompt it re-submits so
// handleRequest recognizes the follow-up turn as a resume.
const APPROVE_COMMAND = 'ResumeRoboRewstyApproval';
const APPROVE_PROMPT = '/approve';

interface ChatTarget {
	session: Session;
	orgId: string;
	conversationId?: string;
}

/** Everything needed to continue after the user clicks Approve. */
interface PendingApproval {
	orgId: string;
	conversationId?: string;
	conversationType: string;
	/**
	 * The message to re-send once the tool is allow-listed. Resuming the paused
	 * request doesn't re-run the tool (allow-listing doesn't mark that request
	 * approved), so we re-ask in the same conversation; a fresh request re-checks
	 * the allow-list at tool-call time and runs the now-allowed tool.
	 */
	message: string;
	toolNames: string[];
	/** true = keep the tool allow-listed (Always allow); false = revert after the turn. */
	always: boolean;
}

interface TurnOptions {
	session: Session;
	orgId: string;
	message: string;
	conversationId?: string;
	conversationType: string;
	/** Resume a paused request instead of sending a fresh message. */
	resumeRequestId?: string;
}

type TurnOutcome =
	| { kind: 'answer'; content: string; sources: ConversationSource[]; conversationId?: string; gate: ChunkGate }
	| { kind: 'approval'; tools: ApprovalTool[]; requestId?: string; conversationId?: string }
	| { kind: 'error'; message: string; conversationId?: string }
	| { kind: 'incomplete'; conversationId?: string };

/** Human-readable description of the tool(s) awaiting approval, with their args. */
function describeApprovalTools(tools: ApprovalTool[]): string {
	if (tools.length === 0) return 'an unspecified Rewst action';
	return tools
		.map(tool => {
			const args = tool.args === undefined ? '' : `\n${truncate(safeJson(tool.args), 500)}`;
			return `- \`${tool.name}\`${args}`;
		})
		.join('\n');
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

export const RewstChatParticipant = new (class RewstChatParticipant implements vscode.Disposable {
	private participant: vscode.ChatParticipant | undefined;
	private approveCommand: vscode.Disposable | undefined;
	// Set when an inline Approve button is clicked; consumed by the resulting
	// /approve turn to resume the paused request.
	private pendingApproval: PendingApproval | undefined;

	init(): this {
		this.participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, (request, chatContext, stream, token) =>
			this.handleRequest(request, chatContext, stream, token),
		);
		this.participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'rewst-buddy.png');
		// The approval buttons can't stream back into a closed response, so they
		// stash the context and re-open the chat with /approve to continue.
		this.approveCommand = vscode.commands.registerCommand(
			`${extPrefix}.${APPROVE_COMMAND}`,
			(ctx: PendingApproval) => {
				this.pendingApproval = ctx;
				// Options-object form auto-submits (a bare string only pre-fills).
				return vscode.commands.executeCommand('workbench.action.chat.open', {
					query: `@rewst ${APPROVE_PROMPT}`,
				});
			},
		);
		log.debug('RewstChatParticipant: registered', PARTICIPANT_ID);
		return this;
	}

	dispose(): void {
		this.participant?.dispose();
		this.participant = undefined;
		this.approveCommand?.dispose();
		this.approveCommand = undefined;
	}

	private async handleRequest(
		request: vscode.ChatRequest,
		chatContext: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	): Promise<vscode.ChatResult> {
		if (!SessionManager.hasActiveSessions()) {
			stream.markdown('No active Rewst session. Create one to talk to RoboRewsty.');
			stream.button({ command: `${extPrefix}.prefix.NewSession`, title: 'New Rewst Session' });
			return {};
		}

		const aiConfig = vscode.workspace.getConfiguration(`${extPrefix}.ai`);
		const workspaceToolsEnabled =
			aiConfig.get<boolean>('enableWorkspaceTools', true) && (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
		const graphQlToolEnabled = aiConfig.get<boolean>('enableGraphqlTool', false);
		const toolsEnabled =
			workspaceToolsEnabled ||
			graphQlToolEnabled ||
			aiConfig.get<boolean>('enableWebTools', false) ||
			aiConfig.get<boolean>('enableCommandTool', false);
		// 0 (or less) means unlimited rounds — the loop runs until the
		// assistant stops requesting tools or the user cancels.
		const configuredRounds = aiConfig.get<number>('maxToolRounds', 4);
		const maxToolRounds = toolsEnabled ? (configuredRounds <= 0 ? Number.POSITIVE_INFINITY : configuredRounds) : 0;

		// Files already attached as references on this response (deduped across rounds).
		const referencedFiles = new Set<string>();
		// Cycle guard: identical tool requests are dropped/blocked across rounds.
		const deduper = new RequestDeduper();
		let consecutiveBlockedRounds = 0;
		// Tools allow-listed for a one-time "Approve"; removed once the turn ends.
		const toolsToRevert = new Set<string>();

		let target: ChatTarget;
		let conversationType: string;
		let message: string;
		let editTarget: vscode.Uri | undefined;

		const pending = this.consumePendingApproval(request);
		if (pending) {
			// Follow-up turn from an inline Approve button: allow-list the tool(s)
			// and resume the paused request (the tool only runs while allow-listed).
			try {
				target = {
					session: SessionManager.getSessionForOrg(pending.orgId),
					orgId: pending.orgId,
					conversationId: pending.conversationId,
				};
			} catch {
				stream.markdown('That Rewst session is no longer available, so the action could not be approved.');
				return {};
			}
			conversationType = pending.conversationType;
			// Re-ask the original request now that the tool will be allow-listed.
			message = pending.message;
			for (const toolName of pending.toolNames) {
				try {
					await target.session.sdk?.addAllowedTool({ toolName });
					if (!pending.always) toolsToRevert.add(toolName);
				} catch (error) {
					log.notifyError(
						`Could not approve "${toolName}": ${error instanceof Error ? error.message : error}`,
					);
				}
			}
			stream.progress('Approved — continuing…');
		} else {
			const resolved = await this.resolveTarget(chatContext);
			if (!resolved) return {};
			target = resolved;
			conversationType = aiConfig.get<string>('conversationType', 'HELP_DOCS');

			// @rewst /resume — load a previous Rewst conversation into the chat
			// and pin this chat session to it.
			if (request.command === 'resume') {
				const resumed = await this.pickAndRenderConversation(target, stream);
				if (!resumed) return {};
				target.conversationId = resumed.id;
				conversationType = resumed.type ?? conversationType;
				if (!request.prompt.trim()) {
					return { metadata: { rewst: { conversationId: resumed.id, orgId: target.orgId } } };
				}
			}
			const customInstructions = aiConfig.get<string>('customInstructions', '');
			stream.progress('Asking RoboRewsty…');

			// Attached files / editor selections (#file, paperclip, implicit
			// selection) arrive as references — inline them into the message.
			const references = await resolveReferences(request.references);
			message = prependInstructions(formatPromptWithReferences(request.prompt, references), customInstructions);
			if (toolsEnabled) {
				const specs = [
					...(workspaceToolsEnabled ? WORKSPACE_TOOL_SPECS : []),
					...(workspaceToolsEnabled && aiConfig.get<boolean>('enableEditTools', true) ? EDIT_TOOL_SPECS : []),
					...(aiConfig.get<boolean>('enableWebTools', false) ? WEB_TOOL_SPECS : []),
					...(aiConfig.get<boolean>('enableCommandTool', false) ? COMMAND_TOOL_SPECS : []),
					...(graphQlToolEnabled ? GRAPHQL_TOOL_SPECS : []),
				];
				if (workspaceToolsEnabled) {
					const overview = await buildWorkspaceOverview();
					if (overview) message += `\n\nThe user's VS Code workspace:\n${overview}`;
				}
				message += `\n\n${buildToolInstructions(specs)}`;
			}
			// Target for apply-suggestion buttons; captured now because the active
			// editor can change while the answer streams.
			editTarget = firstReferencedFileUri(request.references) ?? vscode.window.activeTextEditor?.document.uri;
		}

		let conversationId = target.conversationId;
		const metadata = () => ({ rewst: { conversationId, orgId: target.orgId } });

		try {
			for (let round = 0; ; round++) {
				const turn = await this.runTurn(
					{
						session: target.session,
						orgId: target.orgId,
						message,
						conversationId,
						conversationType,
					},
					stream,
					token,
				);
				conversationId = turn.conversationId ?? conversationId;
				if (turn.kind === 'error') {
					log.debug('RewstChatParticipant: assistant error', turn.message);
					return { errorDetails: { message: turn.message }, metadata: metadata() };
				}
				if (turn.kind === 'incomplete' || token.isCancellationRequested) return { metadata: metadata() };
				if (turn.kind === 'approval') {
					// Inline buttons end the turn; clicking one re-enters via /approve
					// and re-sends this same driving message with the tool allow-listed.
					this.renderApprovalRequest(stream, turn, target.orgId, conversationId, conversationType, message);
					return { metadata: metadata() };
				}

				const requests = toolsEnabled ? parseToolRequests(turn.content) : [];
				if (requests.length === 0 || round >= maxToolRounds) {
					this.renderAnswer(stream, turn, requests.length > 0);
					this.renderSources(stream, turn.sources);
					this.renderApplyButtons(stream, stripToolRequestBlocks(turn.content), editTarget);
					return { metadata: metadata() };
				}

				// Agentic round: run the requested workspace tools locally and
				// feed the results back as the next turn of the conversation.
				const { run, blocked } = deduper.filter(requests, round);
				// A model stuck repeating itself gets one nudge; if the next
				// round is again all repeats, stop instead of looping forever.
				consecutiveBlockedRounds = run.length === 0 ? consecutiveBlockedRounds + 1 : 0;
				if (consecutiveBlockedRounds >= 2) {
					stream.markdown(
						'\n\n*Stopped: RoboRewsty kept repeating identical tool requests. Ask a follow-up to continue.*\n',
					);
					this.renderSources(stream, turn.sources);
					return { metadata: metadata() };
				}
				const results = [
					...blocked.map(blockedRepeatResult),
					...(await runToolRequests(
						run,
						undefined,
						label => stream.progress(label),
						createGraphqlDeps(target.session),
					)),
				];
				this.renderToolActivity(stream, results, referencedFiles);
				message = formatToolResults(results);
				stream.progress('Asking RoboRewsty…');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`RewstChatParticipant: request failed: ${message}`);
			return { errorDetails: { message }, metadata: metadata() };
		} finally {
			// Undo one-time approvals now that the (possibly multi-round) turn is
			// done and the tool has already run server-side.
			for (const toolName of toolsToRevert) {
				try {
					await target.session.sdk?.removeAllowedTool({ toolName });
				} catch (error) {
					log.debug('RewstChatParticipant: approval revert failed', toolName, error);
				}
			}
		}
	}

	/**
	 * Runs one conversationMessage subscription turn, streaming chunks through
	 * a ChunkGate so tool-request JSON never renders in the chat.
	 */
	private async runTurn(
		options: TurnOptions,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	): Promise<TurnOutcome> {
		const gate = new ChunkGate();
		let conversationId = options.conversationId;

		for await (const event of askRewstAi({
			session: options.session,
			orgId: options.orgId,
			message: options.message,
			conversationId,
			conversationType: options.conversationType,
			resumeRequestId: options.resumeRequestId,
			cancellation: token,
		})) {
			switch (event.kind) {
				case 'registered':
					break;
				case 'conversation':
					conversationId = event.conversationId;
					break;
				case 'status':
					stream.progress(event.label);
					break;
				case 'chunk': {
					const visible = gate.push(event.text);
					if (visible) stream.markdown(visible);
					break;
				}
				case 'complete':
					return {
						kind: 'answer',
						content: event.content,
						sources: event.sources,
						conversationId: event.conversationId ?? conversationId,
						gate,
					};
				case 'approval':
					return { kind: 'approval', tools: event.tools, requestId: event.requestId, conversationId };
				case 'error':
					return { kind: 'error', message: event.message, conversationId };
			}
		}
		return { kind: 'incomplete', conversationId };
	}

	/**
	 * If this turn is an Approve-button follow-up, take the stashed context. The
	 * stash is set synchronously right before the chat re-opens, so the next turn
	 * is the approval; we still verify the prompt/command (VS Code may surface the
	 * re-submitted `/approve` as a command, literal prompt, or empty prompt) and
	 * clear any stale stash so it can never leak into a later question.
	 */
	private consumePendingApproval(request: vscode.ChatRequest): PendingApproval | undefined {
		const pending = this.pendingApproval;
		this.pendingApproval = undefined;
		if (!pending) return undefined;
		const prompt = request.prompt.trim();
		const isApproveTurn =
			request.command === 'approve' || prompt === APPROVE_PROMPT || prompt === 'approve' || prompt === '';
		return isApproveTurn ? pending : undefined;
	}

	/**
	 * The turn paused because a Rewst-side agent tool needs the user's approval.
	 * Renders what it wants to run plus inline Approve / Always allow buttons.
	 *
	 * The tool runs server-side only while it is on the user's Rewst allow-list,
	 * and there is no per-request approve mutation — so approving allow-lists the
	 * tool (addAllowedTool) and re-sends the request. "Approve" reverts the
	 * allow-listing afterward (approval_required only fires for tools that weren't
	 * already allowed, so removing restores the prior state); "Always allow" keeps it.
	 */
	private renderApprovalRequest(
		stream: vscode.ChatResponseStream,
		turn: Extract<TurnOutcome, { kind: 'approval' }>,
		orgId: string,
		conversationId: string | undefined,
		conversationType: string,
		message: string,
	): void {
		const description = describeApprovalTools(turn.tools);
		const toolNames = turn.tools.map(tool => tool.name).filter(Boolean);
		// With no named tool we have nothing to allow-list, so re-asking would
		// just pause again — point the user at the web app instead.
		if (toolNames.length === 0) {
			stream.markdown(
				`\n\n*RoboRewsty needs approval to run a Rewst action, but it didn't name the tool, so it can't be approved from here. You can approve it in the Rewst web app.*\n`,
			);
			return;
		}

		stream.markdown(`\n\n*RoboRewsty needs your approval to run a Rewst action:*\n\n${description}\n\n`);

		const base = { orgId, conversationId, conversationType, message, toolNames };
		stream.button({
			command: `${extPrefix}.${APPROVE_COMMAND}`,
			title: 'Approve',
			arguments: [{ ...base, always: false } satisfies PendingApproval],
		});
		const label = toolNames.length === 1 ? `Always allow "${toolNames[0]}"` : 'Always allow these tools';
		stream.button({
			command: `${extPrefix}.${APPROVE_COMMAND}`,
			title: label,
			arguments: [{ ...base, always: true } satisfies PendingApproval],
		});
	}

	/**
	 * Lists the org's stored Rewst conversations in a QuickPick, renders the
	 * picked transcript into the chat, and returns its id/type so follow-ups
	 * continue it. Returns undefined on cancel or when none exist.
	 */
	private async pickAndRenderConversation(
		target: ChatTarget,
		stream: vscode.ChatResponseStream,
	): Promise<{ id: string; type?: string } | undefined> {
		stream.progress('Loading previous conversations…');
		const response = await target.session.sdk?.getConversations({
			where: { orgId: target.orgId },
			limit: 25,
			order: [['updatedAt', 'DESC']],
		});
		const conversations = response?.conversations ?? [];
		if (conversations.length === 0) {
			stream.markdown('No previous Rewst conversations found for this organization.');
			return undefined;
		}

		const pick = await vscode.window.showQuickPick(
			conversations.map(conversation => ({
				label: conversationLabel(conversation.title, conversation.firstUserMessage?.content),
				description: new Date(conversation.updatedAt).toLocaleString(),
				detail: conversation.type,
				id: conversation.id,
				type: conversation.type as string,
			})),
			{ placeHolder: 'Resume a Rewst AI conversation', matchOnDescription: true },
		);
		if (!pick) return undefined;

		stream.progress('Loading conversation…');
		const conversation = (await target.session.sdk?.getConversation({ id: pick.id }))?.conversation;
		if (!conversation) {
			stream.markdown('That conversation could not be loaded (it may have been deleted).');
			return undefined;
		}

		stream.markdown(formatConversationTranscript(conversation.title ?? undefined, conversation.messages));
		return { id: conversation.id, type: conversation.type as string };
	}

	/**
	 * Claude-style activity rendering for one tool round: a compact list of
	 * what was touched (clickable file links), file references on the
	 * response, and an added/removed diff for every edit.
	 */
	private renderToolActivity(
		stream: vscode.ChatResponseStream,
		results: ToolResult[],
		referenced: Set<string>,
	): void {
		const lines = results.map(result => {
			const files = (result.fileUriStrings ?? []).map(uriString => {
				const uri = vscode.Uri.parse(uriString);
				return `[${vscode.workspace.asRelativePath(uri, false)}](${uriString})`;
			});
			const detail =
				files.length > 0 ? files.join(', ') : result.argsLabel ? `\`${result.argsLabel.slice(0, 80)}\`` : '';
			const stats =
				result.ok && result.change ? ` (${diffStats(result.change.before, result.change.after)})` : '';
			return `- \`${result.tool}\` ${detail}${stats}${result.ok ? '' : ' — failed'}`;
		});
		stream.markdown(`\n\n*Tool activity:*\n${lines.join('\n')}\n\n`);

		for (const uriString of results.flatMap(result => result.fileUriStrings ?? [])) {
			if (referenced.has(uriString)) continue;
			referenced.add(uriString);
			try {
				stream.reference(vscode.Uri.parse(uriString));
			} catch (error) {
				log.debug('renderToolActivity: bad reference uri', uriString, error);
			}
		}

		for (const result of results) {
			if (!result.ok || !result.change) continue;
			const diff = renderUnifiedDiff(result.change.before, result.change.after);
			if (!diff) continue;
			const uri = vscode.Uri.parse(result.change.uriString);
			const relative = vscode.workspace.asRelativePath(uri, false);
			const verb = result.change.before === '' ? 'Created' : 'Edited';
			stream.markdown(`**${verb} [${relative}](${result.change.uriString})**\n\`\`\`diff\n${diff}\n\`\`\`\n\n`);
		}
	}

	/** Renders the final answer, covering whatever the chunk stream didn't. */
	private renderAnswer(
		stream: vscode.ChatResponseStream,
		turn: Extract<TurnOutcome, { kind: 'answer' }>,
		toolBudgetExhausted: boolean,
	): void {
		if (turn.gate.streamedAny || turn.gate.blocked) {
			const rest = turn.gate.flush();
			if (rest) stream.markdown(rest);
		} else if (turn.content) {
			const visible = stripToolRequestBlocks(turn.content);
			if (visible) stream.markdown(visible);
		}
		if (toolBudgetExhausted) {
			stream.markdown(
				'\n\n*RoboRewsty wanted to run more tools but hit the tool-round limit (`rewst-buddy.ai.maxToolRounds`). Ask a follow-up to continue.*\n',
			);
		}
	}

	/**
	 * Org/session resolution: prior turn in this chat session wins, then a
	 * single active session's primary org, then an interactive picker.
	 */
	private async resolveTarget(chatContext: vscode.ChatContext): Promise<ChatTarget | undefined> {
		const prior = findPriorTurnState(chatContext.history);
		if (prior?.orgId) {
			try {
				const session = SessionManager.getSessionForOrg(prior.orgId);
				return { session, orgId: prior.orgId, conversationId: prior.conversationId };
			} catch {
				log.debug('RewstChatParticipant: prior session gone, re-resolving', prior.orgId);
			}
		}

		const sessions = SessionManager.getActiveSessions();
		if (sessions.length === 1) {
			return { session: sessions[0], orgId: sessions[0].profile.org.id };
		}

		const pick = await pickOrganization();
		if (!pick) return undefined;
		return { session: pick.session, orgId: pick.org.id };
	}

	/** Offers to apply answer code blocks to the attached/active file via diff preview. */
	private renderApplyButtons(stream: vscode.ChatResponseStream, content: string, target?: vscode.Uri): void {
		if (!target || target.scheme !== 'file') return;
		const blocks = extractCodeBlocks(content).slice(0, 3);
		if (blocks.length === 0) return;

		const name = vscode.workspace.asRelativePath(target, false);
		blocks.forEach((block, index) => {
			stream.button({
				command: `${extPrefix}.ApplyRewstAiEdit`,
				title: blocks.length === 1 ? `Apply to ${name}` : `Apply block ${index + 1} to ${name}`,
				arguments: [{ uri: target.toString(), content: block.content }],
			});
		});
	}

	private renderSources(stream: vscode.ChatResponseStream, sources: ConversationSource[]): void {
		if (sources.length === 0) return;

		const nonUrl: ConversationSource[] = [];
		for (const source of sources) {
			if (/^https?:\/\//.test(source.source)) {
				stream.reference(vscode.Uri.parse(source.source));
			} else {
				nonUrl.push(source);
			}
		}

		if (nonUrl.length > 0) {
			const lines = nonUrl.map(s => `- ${s.label}${s.section ? ` — ${s.section}` : ''}`);
			stream.markdown(`\n\n**Sources**\n${lines.join('\n')}\n`);
		}
	}
})();
