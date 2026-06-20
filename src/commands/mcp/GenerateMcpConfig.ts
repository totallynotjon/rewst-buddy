import { extPrefix } from '@global';
import { formatHostPort, getServerConfig } from '@server';
import { log } from '@utils';
import vscode from 'vscode';
import { getMcpToken, mcpAuthorizationHeader } from '@mcp';
import GenericCommand from '../GenericCommand';

/**
 * Prints the MCP client configuration that points an external client (Claude
 * Desktop, Claude Code, Cursor) at the extension's in-process MCP HTTP server.
 * The client connects to the localhost /mcp URL and presents the per-install
 * token as a header — no separate process, no `node`, no secrets in the config.
 */
export class GenerateMcpConfig extends GenericCommand {
	commandName = 'GenerateMcpConfig';

	async execute(): Promise<void> {
		const { host, port } = getServerConfig();
		const config = {
			mcpServers: {
				'rewst-buddy': {
					url: `http://${formatHostPort(host, port)}/mcp`,
					headers: { Authorization: mcpAuthorizationHeader(getMcpToken()) },
				},
			},
		};
		const json = JSON.stringify(config, null, 2);

		const enabled = vscode.workspace.getConfiguration(`${extPrefix}.mcp`).get<boolean>('enable', false);
		const doc = await vscode.workspace.openTextDocument({ language: 'json', content: json });
		await vscode.window.showTextDocument(doc, { preview: false });
		await vscode.env.clipboard.writeText(json);

		log.info('GenerateMcpConfig: produced client config');

		const notes = [
			'MCP client config copied to clipboard and opened in an editor.',
			'Add it to your MCP client (e.g. Claude Desktop) config and restart it.',
			enabled
				? ''
				: 'Note: rewst-buddy.mcp.enable is currently off — turn it on so the server accepts connections.',
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
