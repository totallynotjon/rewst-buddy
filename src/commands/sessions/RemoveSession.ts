import { SessionManager, SessionProfile } from '@sessions';
import { SessionTreeItem, pickKnownProfile } from '@ui';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class RemoveSession extends GenericCommand {
	commandName = 'RemoveSession';

	async execute(...args: unknown[]): Promise<void> {
		const profile = await this.resolveProfile(args);
		if (!profile) return;

		const userId = profile.user.id;
		if (!userId) {
			log.notifyError(`RemoveSession: profile '${profile.label}' has no user id`);
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Remove session "${profile.label}"? Its stored credentials will be deleted.`,
			{ modal: true },
			'Remove',
		);
		if (confirm !== 'Remove') return;

		try {
			await SessionManager.removeSession(userId);
			log.notifyInfo(`Removed session '${profile.label}'`);
		} catch (error) {
			log.notifyError(`Failed to remove session: ${error}`);
		}
	}

	private async resolveProfile(args: unknown[]): Promise<SessionProfile | undefined> {
		const first = args[0];
		const item = Array.isArray(first) ? first[0] : undefined;
		if (item instanceof SessionTreeItem) return item.profile;
		return pickKnownProfile();
	}
}
