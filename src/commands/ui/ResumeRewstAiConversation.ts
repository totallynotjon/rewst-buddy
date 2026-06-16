import { SessionManager } from '@sessions';
import { conversationLabel, formatConversationTranscript, pickSession } from '@ui';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

/**
 * Lists the org's stored Rewst AI conversations and opens the picked transcript
 * as a markdown document. Follow-up binding is intentionally deferred until the
 * stateless chat model has a transcript-import resume flow.
 */
export class ResumeRewstAiConversation extends GenericCommand {
	commandName = 'ResumeRewstAiConversation';

	async execute(): Promise<void> {
		const sessions = SessionManager.getActiveSessions();
		const session = sessions.length === 1 ? sessions[0] : await pickSession();
		if (!session) return;
		const orgId = session.profile.org.id;

		const response = await session.sdk?.getConversations({
			where: { orgId },
			limit: 25,
			order: [['updatedAt', 'DESC']],
		});
		const conversations = response?.conversations ?? [];
		if (conversations.length === 0) {
			log.notifyInfo('No previous Rewst AI conversations found for this organization.');
			return;
		}

		const pick = await vscode.window.showQuickPick(
			conversations.map(conversation => ({
				label: conversationLabel(conversation.title, conversation.firstUserMessage?.content),
				description: new Date(conversation.updatedAt).toLocaleString(),
				detail: conversation.type,
				id: conversation.id,
			})),
			{ placeHolder: 'Resume a Rewst AI conversation', matchOnDescription: true },
		);
		if (!pick) return;

		const conversation = (await session.sdk?.getConversation({ id: pick.id }))?.conversation;
		if (!conversation) {
			log.notifyError('That conversation could not be loaded (it may have been deleted).');
			return;
		}

		const transcript = formatConversationTranscript(conversation.title ?? undefined, conversation.messages);
		const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: transcript });
		await vscode.window.showTextDocument(document, { preview: true });

		log.notifyInfo('Conversation transcript opened.');
	}
}
