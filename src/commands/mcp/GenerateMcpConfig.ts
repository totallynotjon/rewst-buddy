import { context, extPrefix } from '@global';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

/**
 * Prints the MCP client configuration that points an external client (Claude
 * Desktop, Claude Code, Cursor) at the bundled credential-free bridge. The
 * client spawns `node <bridge>`; the bridge discovers the live port + token from
 * ~/.rewst-buddy/mcp.json at runtime, so no secrets appear in the config.
 */
export class GenerateMcpConfig extends GenericCommand {
	commandName = 'GenerateMcpConfig';

	async execute(): Promise<void> {
		const bridgePath = context.asAbsolutePath('dist/mcp/rewst-mcp.js');
		const config = {
			mcpServers: {
				'rewst-buddy': {
					command: 'node',
					args: [bridgePath],
				},
			},
		};

		const enabled = vscode.workspace.getConfiguration(`${extPrefix}.mcp`).get<boolean>('enable', false);
		const doc = await vscode.workspace.openTextDocument({
			language: 'json',
			content: JSON.stringify(config, null, 2),
		});
		await vscode.window.showTextDocument(doc, { preview: false });
		await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));

		log.info('GenerateMcpConfig: produced client config');

		const notes = [
			'MCP client config copied to clipboard and opened in an editor.',
			'Add it to your MCP client (e.g. Claude Desktop) config.',
			'The client runs `node`, so Node.js must be on its PATH.',
			enabled ? '' : 'Note: rewst-buddy.mcp.enable is currently off — turn it on so the bridge can connect.',
		]
			.filter(Boolean)
			.join(' ');

		if (enabled) {
			vscode.window.showInformationMessage(notes);
			return;
		}

		const choice = await vscode.window.showInformationMessage(notes, 'Enable MCP server');
		if (choice === 'Enable MCP server') {
			await vscode.workspace
				.getConfiguration(`${extPrefix}.mcp`)
				.update('enable', true, vscode.ConfigurationTarget.Global);
		}
	}
}
