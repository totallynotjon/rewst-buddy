import { context, extPrefix } from '@global';
import { askRewstAi, Session, SessionManager, type ConversationSource } from '@sessions';
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

const PARTICIPANT_ID = 'rewst-buddy.rewst';

interface ChatTarget {
	session: Session;
	orgId: string;
	conversationId?: string;
}

interface TurnOptions {
	session: Session;
	orgId: string;
	message: string;
	conversationId?: string;
	conversationType: string;
}

type TurnOutcome =
	| { kind: 'answer'; content: string; sources: ConversationSource[]; conversationId?: string; gate: ChunkGate }
	| { kind: 'error'; message: string; conversationId?: string }
	| { kind: 'incomplete'; conversationId?: string };

export const RewstChatParticipant = new (class RewstChatParticipant implements vscode.Disposable {
	private participant: vscode.ChatParticipant | undefined;

	init(): this {
		this.participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, (request, chatContext, stream, token) =>
			this.handleRequest(request, chatContext, stream, token),
		);
		this.participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'rewst-buddy.png');
		log.debug('RewstChatParticipant: registered', PARTICIPANT_ID);
		return this;
	}

	dispose(): void {
		this.participant?.dispose();
		this.participant = undefined;
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

		const target = await this.resolveTarget(chatContext);
		if (!target) return {};

		const aiConfig = vscode.workspace.getConfiguration(`${extPrefix}.ai`);
		let conversationType = aiConfig.get<string>('conversationType', 'HELP_DOCS');

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
		const toolsEnabled =
			aiConfig.get<boolean>('enableWorkspaceTools', true) && (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
		// 0 (or less) means unlimited rounds — the loop runs until the
		// assistant stops requesting tools or the user cancels.
		const configuredRounds = aiConfig.get<number>('maxToolRounds', 4);
		const maxToolRounds = toolsEnabled ? (configuredRounds <= 0 ? Number.POSITIVE_INFINITY : configuredRounds) : 0;

		stream.progress('Asking RoboRewsty…');

		// Attached files / editor selections (#file, paperclip, implicit
		// selection) arrive as references — inline them into the message.
		const references = await resolveReferences(request.references);
		let message = prependInstructions(formatPromptWithReferences(request.prompt, references), customInstructions);
		if (toolsEnabled) {
			const specs = [
				...WORKSPACE_TOOL_SPECS,
				...(aiConfig.get<boolean>('enableEditTools', true) ? EDIT_TOOL_SPECS : []),
				...(aiConfig.get<boolean>('enableWebTools', false) ? WEB_TOOL_SPECS : []),
				...(aiConfig.get<boolean>('enableCommandTool', false) ? COMMAND_TOOL_SPECS : []),
			];
			const overview = await buildWorkspaceOverview();
			if (overview) message += `\n\nThe user's VS Code workspace:\n${overview}`;
			message += `\n\n${buildToolInstructions(specs)}`;
		}
		// Target for apply-suggestion buttons; captured now because the active
		// editor can change while the answer streams.
		const editTarget = firstReferencedFileUri(request.references) ?? vscode.window.activeTextEditor?.document.uri;

		let conversationId = target.conversationId;
		const metadata = () => ({ rewst: { conversationId, orgId: target.orgId } });
		// Files already attached as references on this response (deduped across rounds).
		const referencedFiles = new Set<string>();
		// Cycle guard: identical tool requests are dropped/blocked across rounds.
		const deduper = new RequestDeduper();
		let consecutiveBlockedRounds = 0;

		try {
			for (let round = 0; ; round++) {
				const turn = await this.runTurn(
					{ session: target.session, orgId: target.orgId, message, conversationId, conversationType },
					stream,
					token,
				);
				conversationId = turn.conversationId ?? conversationId;
				if (turn.kind === 'error') {
					log.debug('RewstChatParticipant: assistant error', turn.message);
					return { errorDetails: { message: turn.message }, metadata: metadata() };
				}
				if (turn.kind === 'incomplete' || token.isCancellationRequested) return { metadata: metadata() };

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
					...(await runToolRequests(run, undefined, label => stream.progress(label))),
				];
				this.renderToolActivity(stream, results, referencedFiles);
				message = formatToolResults(results);
				stream.progress('Asking RoboRewsty…');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`RewstChatParticipant: request failed: ${message}`);
			return { errorDetails: { message }, metadata: metadata() };
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
				case 'error':
					return { kind: 'error', message: event.message, conversationId };
			}
		}
		return { kind: 'incomplete', conversationId };
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
		stream.markdown(`\n\n*Workspace activity:*\n${lines.join('\n')}\n\n`);

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
				'\n\n*RoboRewsty wanted to inspect more of the workspace but hit the tool-round limit (`rewst-buddy.ai.maxToolRounds`). Ask a follow-up to continue.*\n',
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
