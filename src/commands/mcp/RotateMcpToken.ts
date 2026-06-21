import { rotateMcpToken } from '@mcp';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

const ROTATE_ACTION = 'Rotate Token';

export class RotateMcpToken extends GenericCommand {
	commandName = 'RotateMcpToken';

	async execute(): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(
			'Rotate the MCP token? Existing MCP clients holding the old token will lose access until you update their config.',
			{ modal: true },
			ROTATE_ACTION,
		);
		if (confirm !== ROTATE_ACTION) return;

		try {
			rotateMcpToken();
			log.notifyInfo(
				'MCP token rotated. Run "Rewst Buddy: Copy MCP Config to Clipboard" to update external clients with the new token.',
			);
		} catch (error) {
			log.notifyError('RotateMcpToken: failed to rotate MCP token', error);
		}
	}
}
