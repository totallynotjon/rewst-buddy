import { context, extPrefix } from '@global';
import { askRewstAi, Session, SessionManager, type ConversationSource } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { pickOrganization } from '../pickers';
import { findPriorTurnState } from './chatHistory';
import { extractCodeBlocks } from './codeBlocks';
import {
	firstReferencedFileUri,
	formatPromptWithReferences,
	prependInstructions,
	resolveReferences,
} from './promptContext';

const PARTICIPANT_ID = 'rewst-buddy.rewst';

interface ChatTarget {
	session: Session;
	orgId: string;
	conversationId?: string;
}

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
		const conversationType = aiConfig.get<string>('conversationType', 'HELP_DOCS');
		const customInstructions = aiConfig.get<string>('customInstructions', '');

		stream.progress('Asking RoboRewsty…');

		// Attached files / editor selections (#file, paperclip, implicit
		// selection) arrive as references — inline them into the message.
		const references = await resolveReferences(request.references);
		const message = prependInstructions(formatPromptWithReferences(request.prompt, references), customInstructions);
		// Target for apply-suggestion buttons; captured now because the active
		// editor can change while the answer streams.
		const editTarget = firstReferencedFileUri(request.references) ?? vscode.window.activeTextEditor?.document.uri;

		let conversationId = target.conversationId;
		const metadata = () => ({ rewst: { conversationId, orgId: target.orgId } });
		let streamedAny = false;

		try {
			for await (const event of askRewstAi({
				session: target.session,
				orgId: target.orgId,
				message,
				conversationId,
				conversationType,
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
					case 'chunk':
						streamedAny = true;
						stream.markdown(event.text);
						break;
					case 'complete':
						if (!streamedAny && event.content) stream.markdown(event.content);
						conversationId = event.conversationId ?? conversationId;
						this.renderSources(stream, event.sources);
						this.renderApplyButtons(stream, event.content, editTarget);
						break;
					case 'error':
						log.debug('RewstChatParticipant: assistant error', event.message);
						return { errorDetails: { message: event.message }, metadata: metadata() };
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`RewstChatParticipant: request failed: ${message}`);
			return { errorDetails: { message }, metadata: metadata() };
		}

		return { metadata: metadata() };
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
