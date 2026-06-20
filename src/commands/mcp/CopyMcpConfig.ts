import { extPrefix } from '@global';
import { formatHostPort, getServerConfig } from '@server';
import { log } from '@utils';
import vscode from 'vscode';
import { getMcpToken } from '@mcp';
import GenericCommand from '../GenericCommand';

/** Env var the generated config expects the client to expand into the bearer token. */
const MCP_TOKEN_ENV_VAR = 'REWST_BUDDY_MCP_TOKEN';

/**
 * Copies the MCP client configuration that points an external client (Claude
 * Desktop, Claude Code, Cursor) at the extension's in-process MCP HTTP server, and
 * opens it in an editor. The client connects to the localhost /mcp URL and
 * presents the per-install token in the standard `Authorization: Bearer` header.
 * The token is not written into the config blob — it is referenced via the
 * `REWST_BUDDY_MCP_TOKEN` environment variable and delivered through a separate
 * "Copy token" step, so the config stays credential-free (no process, no `node`,
 * no embedded secret). For VS Code's own MCP client, the "Add MCP to VS Code"
 * command registers the server natively instead — no config copy needed.
 */
export class CopyMcpConfig extends GenericCommand {
	commandName = 'CopyMcpConfig';

	async execute(): Promise<void> {
		const { host, port } = getServerConfig();
		const config = {
			mcpServers: {
				'rewst-buddy': {
					url: `http://${formatHostPort(host, port)}/mcp`,
					// Credential-free: the client expands the env var into the token, so the
					// blob can be shared without leaking the localhost token.
					headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV_VAR}}` },
				},
			},
		};
		const json = JSON.stringify(config, null, 2);

		const enabled = vscode.workspace.getConfiguration(`${extPrefix}.mcp`).get<boolean>('enable', false);
		await vscode.env.clipboard.writeText(json);
		const doc = await vscode.workspace.openTextDocument({ language: 'json', content: json });
		await vscode.window.showTextDocument(doc, { preview: false });

		log.info('CopyMcpConfig: copied credential-free client config to clipboard');

		const notes = [
			'MCP client config copied to clipboard and opened in an editor — no token inside.',
			`Set the ${MCP_TOKEN_ENV_VAR} environment variable to the localhost token for your MCP client (use "Copy token"). Clients that do not expand env vars can paste the token in place of \${${MCP_TOKEN_ENV_VAR}}.`,
			enabled ? '' : 'rewst-buddy.mcp.enable is currently off — turn it on so the server accepts connections.',
		]
			.filter(Boolean)
			.join(' ');

		const actions = enabled ? ['Copy token'] : ['Enable MCP server', 'Copy token'];
		const choice = await vscode.window.showInformationMessage(notes, ...actions);
		if (choice === 'Enable MCP server') {
			await vscode.workspace
				.getConfiguration(`${extPrefix}.mcp`)
				.update('enable', true, vscode.ConfigurationTarget.Global);
		} else if (choice === 'Copy token') {
			await vscode.env.clipboard.writeText(getMcpToken());
			vscode.window.showInformationMessage(`${MCP_TOKEN_ENV_VAR} value copied to clipboard.`);
		}
	}
}
